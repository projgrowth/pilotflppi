// Stage: challenger.
// A stricter second-opinion pass for HIGH-STAKES findings only — the kind a
// private provider would be sued over. Runs after ground_citations so we have
// the canonical code text in hand and can ask the model to argue against the
// finding using the actual statute, not a paraphrase.
//
// Targets:
//   - life_safety_flag = true OR permit_blocker = true
//   - confidence_score < 0.7 (already-confident findings don't need it)
//   - status = 'open' (resolved/waived are out of scope)
//   - citation_status = 'grounded' (no point challenging a stub citation)
//   - verified_by_challenger = false (idempotent re-runs)
//
// Strategy: a different framing ("argue this finding is WRONG") and a
// stronger model (gemini-2.5-pro) than the critic. If the challenger
// concedes the finding stands, we badge it `verified_by_challenger=true`
// and bump confidence. If it overturns, we mark it `requires_human_review`
// with the challenger's argument so the reviewer adjudicates.

import { createClient } from "../_shared/supabase.ts";
import { callAI } from "../_shared/ai.ts";

const CHALLENGER_SCHEMA = {
  name: "submit_challenges",
  description:
    "For each high-stakes finding, argue whether it should be OVERTURNED or UPHELD. Be adversarial — your job is to find the strongest reason a senior plans examiner would delete this finding before it ships.",
  parameters: {
    type: "object",
    properties: {
      challenges: {
        type: "array",
        items: {
          type: "object",
          properties: {
            deficiency_id: { type: "string" },
            verdict: { type: "string", enum: ["upheld", "overturned"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            argument: { type: "string", description: "1-3 sentence reasoning that a senior reviewer would accept." },
          },
          required: ["deficiency_id", "verdict", "confidence", "argument"],
          additionalProperties: false,
        },
      },
    },
    required: ["challenges"],
    additionalProperties: false,
  },
} as const;

const CHALLENGER_SYSTEM =
  "You are an adversarial senior plans examiner reviewing AI-drafted HIGH-STAKES " +
  "deficiencies (life-safety or permit-blocker). For each finding, your job is to " +
  "argue it should be OVERTURNED unless the canonical code text the AI cited " +
  "clearly supports it. Be skeptical: vague applicability, wrong code chapter, " +
  "or evidence that doesn't actually demonstrate the violation are all grounds " +
  "to overturn. Only return verdict='upheld' when you're satisfied a contractor " +
  "would lose a defensibility argument on this finding.";

interface ChallengerRow {
  id: string;
  def_number: string;
  discipline: string;
  finding: string;
  required_action: string;
  evidence: string[];
  code_reference: { code?: string; section?: string; edition?: string } | null;
  citation_canonical_text: string | null;
  confidence_score: number | null;
  life_safety_flag: boolean;
  permit_blocker: boolean;
}

export async function stageChallenger(
  admin: ReturnType<typeof createClient>,
  planReviewId: string,
) {
  const { data: rowsRaw, error } = await admin
    .from("deficiencies_v2")
    .select(
      "id, def_number, discipline, finding, required_action, evidence, code_reference, citation_canonical_text, confidence_score, life_safety_flag, permit_blocker, verified_by_challenger, status, citation_status",
    )
    .eq("plan_review_id", planReviewId)
    .eq("status", "open")
    .eq("citation_status", "grounded")
    .eq("verified_by_challenger", false)
    .or("life_safety_flag.eq.true,permit_blocker.eq.true");
  if (error) throw error;

  const rows = (rowsRaw ?? []) as Array<
    ChallengerRow & { verified_by_challenger: boolean; status: string; citation_status: string }
  >;

  // Only challenge findings whose confidence is below the trust threshold.
  const targets = rows.filter((r) => (r.confidence_score ?? 0.5) < 0.7);
  if (targets.length === 0) {
    return { examined: 0, upheld: 0, overturned: 0, skipped: rows.length };
  }

  const BATCH = 6;
  let upheld = 0;
  let overturned = 0;
  let failed = 0;

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
          : "(none)";
        const canonical = (r.citation_canonical_text ?? "").slice(0, 800);
        return (
          `--- deficiency_id: ${r.id}\n` +
          `def: ${r.def_number} (${r.discipline})\n` +
          `flags: ${r.life_safety_flag ? "LIFE-SAFETY " : ""}${r.permit_blocker ? "PERMIT-BLOCKER" : ""}\n` +
          `cited_code: ${code}\n` +
          `canonical_code_text: ${canonical || "(none on file)"}\n` +
          `finding: ${r.finding}\n` +
          `required_action: ${r.required_action}\n` +
          `quoted_evidence: ${evidence}`
        );
      })
      .join("\n\n");

    let result: {
      challenges: Array<{
        deficiency_id: string;
        verdict: "upheld" | "overturned";
        confidence: number;
        argument: string;
      }>;
    };
    try {
      result = (await callAI(
        [
          { role: "system", content: CHALLENGER_SYSTEM },
          {
            role: "user",
            content: `Challenge each of the ${slice.length} HIGH-STAKES findings below. Return one entry per deficiency_id via submit_challenges.\n\n${userText}`,
          },
        ],
        CHALLENGER_SCHEMA as unknown as Record<string, unknown>,
        // Stronger model than the critic. The cost is bounded — we only
        // challenge a small fraction of findings (high-stakes + low-confidence).
        "google/gemini-2.5-pro",
        0,
      )) as typeof result;
    } catch (err) {
      console.error("[challenger] batch failed:", err);
      failed += slice.length;
      continue;
    }

    const byId = new Map(slice.map((r) => [r.id, r] as const));
    for (const c of result.challenges ?? []) {
      const target = byId.get(c.deficiency_id);
      if (!target) continue;
      const arg = (c.argument ?? "").slice(0, 600);

      if (c.verdict === "upheld") {
        await admin
          .from("deficiencies_v2")
          .update({
            verified_by_challenger: true,
            confidence_score: Math.min(0.97, (target.confidence_score ?? 0.5) + 0.15),
            verification_notes: `Challenger upheld: ${arg}`,
          })
          .eq("id", target.id);
        upheld++;
      } else {
        await admin
          .from("deficiencies_v2")
          .update({
            requires_human_review: true,
            human_review_reason: `Challenger argues this finding may be wrong: ${arg}`,
            human_review_method: "challenger_overturn",
            confidence_score: Math.max(0.1, (target.confidence_score ?? 0.5) * 0.6),
          })
          .eq("id", target.id);
        overturned++;
      }
    }
  }

  return { examined: targets.length, upheld, overturned, failed, skipped: rows.length - targets.length };
}
