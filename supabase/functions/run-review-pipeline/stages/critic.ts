// Stage: critic.
// A second-opinion pass over each finding produced by discipline_review.
// Unlike `verify` (which is image-grounded and adversarial), the critic is
// text-only and fast: it scores each finding for internal coherence and
// citation plausibility, then writes a `critic_score` and downgrades obvious
// junk before grounding/verify spend cycles on it.
//
// Cheap: one batched AI call per ~10 findings. Designed to slot into CORE
// after discipline_review and before dedupe so dedupe sees critic-cleaned
// rows (saves money on the more expensive verify pass too).
//
// Outputs (per finding) — written into evidence_crop_meta.critic so we don't
// need a schema migration:
//   { score: 0..1, verdict: "keep"|"weak"|"junk", reasons: string[] }
//
// Side effects:
//   - verdict='junk' → status='waived', reviewer_disposition='reject',
//     reviewer_notes prefixed "Auto-suppressed by critic: ..."
//   - verdict='weak' → confidence_score scaled down by 0.7,
//     requires_human_review=true, human_review_reason populated
//   - verdict='keep' → confidence_score nudged up by 0.05 (max 0.95)

import { createClient } from "../_shared/supabase.ts";
import { callAI } from "../_shared/ai.ts";

const CRITIC_SCHEMA = {
  name: "submit_critiques",
  description:
    "For each finding, return a critic verdict assessing whether the finding is well-formed, defensible, and likely correct based on text-only signals (no image evidence available).",
  parameters: {
    type: "object",
    properties: {
      critiques: {
        type: "array",
        items: {
          type: "object",
          properties: {
            deficiency_id: { type: "string" },
            verdict: { type: "string", enum: ["keep", "weak", "junk"] },
            score: { type: "number", minimum: 0, maximum: 1 },
            reasons: { type: "array", items: { type: "string" } },
          },
          required: ["deficiency_id", "verdict", "score", "reasons"],
          additionalProperties: false,
        },
      },
    },
    required: ["critiques"],
    additionalProperties: false,
  },
} as const;

const CRITIC_SYSTEM =
  "You are a senior plans-review editor auditing AI-drafted deficiencies for INTERNAL COHERENCE. " +
  "You do not have the plan images — judge purely on the finding text, required action, cited code, " +
  "and quoted evidence. Score 0..1 and pick a verdict:\n" +
  "  - 'keep'  — finding is specific, the action is concrete, the citation is plausible, evidence quotes are non-empty.\n" +
  "  - 'weak'  — finding is real but vague, the action is generic ('review and revise'), or the citation looks off.\n" +
  "  - 'junk'  — finding is restating the obvious, contradicts itself, cites a clearly wrong code section, or is a duplicate-shape boilerplate with no concrete defect.\n" +
  "Be conservative — only mark 'junk' when you are confident a senior reviewer would delete the row.";

interface CriticRow {
  id: string;
  def_number: string;
  discipline: string;
  finding: string;
  required_action: string;
  evidence: string[];
  code_reference: { code?: string; section?: string; edition?: string } | null;
  confidence_score: number | null;
  evidence_crop_meta: Record<string, unknown> | null;
}

// Tier 3.2: Bias the critic with firm-specific reject patterns the human
// reviewers have already corrected. The model gets a short list of "this
// firm has rejected findings that look like X for reason Y" so it
// preferentially flags repeats of the same shape as `weak`/`junk`.
async function loadFirmRejectPatterns(
  admin: ReturnType<typeof createClient>,
  firmId: string | null,
  disciplines: string[],
): Promise<string> {
  if (!firmId || disciplines.length === 0) return "";
  const { data, error } = await admin
    .from("correction_patterns")
    .select("discipline, pattern_summary, rejection_reason, reason_notes, rejection_count")
    .eq("firm_id", firmId)
    .eq("is_active", true)
    .in("discipline", disciplines)
    .order("rejection_count", { ascending: false })
    .limit(12);
  if (error || !data || data.length === 0) return "";
  const lines = (data as Array<{
    discipline: string;
    pattern_summary: string;
    rejection_reason: string;
    reason_notes: string | null;
    rejection_count: number;
  }>).map(
    (p) =>
      `- [${p.discipline}] ${p.pattern_summary} — rejected ${p.rejection_count}× because: ${p.rejection_reason}${
        p.reason_notes ? ` (${p.reason_notes.slice(0, 120)})` : ""
      }`,
  );
  return (
    "\n\nThis firm has previously REJECTED findings matching these shapes. " +
    "If a finding below resembles any of these, downgrade it (weak or junk):\n" +
    lines.join("\n")
  );
}

export async function stageCritic(
  admin: ReturnType<typeof createClient>,
  planReviewId: string,
) {
  const { data: prRow } = await admin
    .from("plan_reviews")
    .select("firm_id")
    .eq("id", planReviewId)
    .maybeSingle();
  const firmId = (prRow as { firm_id: string | null } | null)?.firm_id ?? null;

  const { data: rowsRaw, error } = await admin
    .from("deficiencies_v2")
    .select(
      "id, def_number, discipline, finding, required_action, evidence, code_reference, confidence_score, evidence_crop_meta, status, verification_status",
    )
    .eq("plan_review_id", planReviewId)
    .neq("status", "resolved")
    .neq("status", "waived")
    .neq("verification_status", "carryover")
    .neq("verification_status", "superseded");
  if (error) throw error;

  const rows = (rowsRaw ?? []) as Array<CriticRow & { status: string; verification_status: string }>;
  // Skip rows the critic has already scored (idempotent re-runs).
  const targets = rows.filter(
    (r) =>
      !((r.evidence_crop_meta ?? {}) as Record<string, unknown>).critic,
  );
  if (targets.length === 0) {
    return { examined: 0, kept: 0, weak: 0, junk: 0, skipped: rows.length };
  }

  const disciplines = Array.from(new Set(targets.map((t) => t.discipline).filter(Boolean)));
  const learnedPatternsBlock = await loadFirmRejectPatterns(admin, firmId, disciplines);
  const criticSystem = CRITIC_SYSTEM + learnedPatternsBlock;

  const BATCH = 10;
  let kept = 0;
  let weak = 0;
  let junk = 0;
  let failed = 0;
  const usedLearnedPatterns = learnedPatternsBlock.length > 0;

  for (let i = 0; i < targets.length; i += BATCH) {
    const slice = targets.slice(i, i + BATCH);
    const userText = slice
      .map((r) => {
        const code = r.code_reference
          ? [r.code_reference.code, r.code_reference.section, r.code_reference.edition]
              .filter(Boolean)
              .join(" ")
          : "(no citation)";
        const evidence = (r.evidence ?? []).length
          ? (r.evidence ?? []).map((e) => `"${e}"`).join(" | ")
          : "(none — finding has no quoted evidence)";
        return (
          `--- deficiency_id: ${r.id}\n` +
          `def: ${r.def_number} (${r.discipline})\n` +
          `code: ${code}\n` +
          `finding: ${r.finding}\n` +
          `required_action: ${r.required_action}\n` +
          `quoted_evidence: ${evidence}`
        );
      })
      .join("\n\n");

    let result: { critiques: Array<{ deficiency_id: string; verdict: "keep" | "weak" | "junk"; score: number; reasons: string[] }> };
    try {
      result = (await callAI(
        [
          { role: "system", content: criticSystem },
          {
            role: "user",
            content: `Critique each of the ${slice.length} findings below. Return one entry per deficiency_id via submit_critiques.\n\n${userText}`,
          },
        ],
        CRITIC_SCHEMA as unknown as Record<string, unknown>,
        "google/gemini-2.5-flash",
      )) as typeof result;
    } catch (err) {
      console.error("[critic] batch failed:", err);
      failed += slice.length;
      continue;
    }

    const byId = new Map(slice.map((r) => [r.id, r] as const));
    for (const c of result.critiques ?? []) {
      const target = byId.get(c.deficiency_id);
      if (!target) continue;

      const reasons = (c.reasons ?? []).slice(0, 5).map((s) => s.slice(0, 200));
      const score = Math.max(0, Math.min(1, c.score ?? 0.5));
      const meta = {
        ...((target.evidence_crop_meta ?? {}) as Record<string, unknown>),
        critic: { score, verdict: c.verdict, reasons, ran_at: new Date().toISOString() },
      };
      const baseConf = target.confidence_score ?? 0.5;
      const patch: Record<string, unknown> = { evidence_crop_meta: meta };

      if (c.verdict === "junk") {
        patch.status = "waived";
        patch.reviewer_disposition = "reject";
        patch.reviewer_notes = `Auto-suppressed by critic: ${reasons.join(" / ") || "low coherence score"}`;
        patch.confidence_score = Math.min(baseConf, 0.2);
        junk++;
      } else if (c.verdict === "weak") {
        patch.confidence_score = Math.max(0.1, baseConf * 0.7);
        patch.requires_human_review = true;
        patch.human_review_reason = `Critic flagged this finding as weak: ${reasons.join(" / ") || "vague or unsupported"}`;
        weak++;
      } else {
        // keep — small confidence nudge so downstream gates trust it more
        patch.confidence_score = Math.min(0.95, baseConf + 0.05);
        kept++;
      }

      const { error: upErr } = await admin.from("deficiencies_v2").update(patch).eq("id", target.id);
      if (upErr) console.error("[critic] update failed", target.id, upErr);
    }
  }

  return { examined: targets.length, kept, weak, junk, failed, skipped: rows.length - targets.length };
}
