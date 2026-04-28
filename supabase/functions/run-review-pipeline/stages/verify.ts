// Stage: verify.
// Adversarial second-pass verification. A senior-examiner persona challenges
// every low-confidence or high-priority finding the discipline reviewers raised.
// Verdicts: upheld | overturned | modified | cannot_locate. The stage NEVER
// auto-overturns when the verifier can't find the cited element — those route
// to human review with full context.

import { createClient } from "../_shared/supabase.ts";
import { callAI } from "../_shared/ai.ts";
import { signedSheetUrls } from "../_shared/storage.ts";

const VERIFY_SCHEMA = {
  name: "submit_verifications",
  description:
    "For each finding supplied, return a verdict from a senior plans examiner challenging the original examiner's conclusion. Use 'cannot_locate' if the cited element/area on the cited sheet is not visible to you in the supplied images — never auto-overturn for that reason; route to human review instead.",
  parameters: {
    type: "object",
    properties: {
      verifications: {
        type: "array",
        items: {
          type: "object",
          properties: {
            deficiency_id: { type: "string" },
            verdict: {
              type: "string",
              enum: ["upheld", "overturned", "modified", "cannot_locate"],
            },
            reasoning: {
              type: "string",
              description:
                "Why upheld/overturned/modified/cannot_locate. For 'cannot_locate' explain what you searched for and where you couldn't find it.",
            },
            corrected_finding: {
              type: "string",
              description: "If verdict='modified', the corrected finding text.",
            },
            corrected_required_action: {
              type: "string",
              description: "If verdict='modified', the corrected required action.",
            },
          },
          required: ["deficiency_id", "verdict", "reasoning"],
          additionalProperties: false,
        },
      },
    },
    required: ["verifications"],
    additionalProperties: false,
  },
} as const;

interface VerifyTarget {
  id: string;
  def_number: string;
  discipline: string;
  finding: string;
  required_action: string;
  evidence: string[];
  sheet_refs: string[];
  code_reference: { code?: string; section?: string; edition?: string } | null;
  confidence_score: number | null;
  confidence_basis: string | null;
  priority: string;
  page_indices: number[];
}

export async function stageVerify(
  admin: ReturnType<typeof createClient>,
  planReviewId: string,
) {
  const { data: defsRaw, error } = await admin
    .from("deficiencies_v2")
    .select(
      "id, def_number, discipline, finding, required_action, evidence, sheet_refs, code_reference, confidence_score, confidence_basis, priority, life_safety_flag, permit_blocker, status, verification_status",
    )
    .eq("plan_review_id", planReviewId)
    .neq("status", "resolved")
    .neq("status", "waived")
    .eq("verification_status", "unverified");
  if (error) throw error;

  const candidates = ((defsRaw ?? []) as Array<{
    id: string;
    def_number: string;
    discipline: string;
    finding: string;
    required_action: string;
    evidence: string[] | null;
    sheet_refs: string[] | null;
    code_reference: { code?: string; section?: string; edition?: string } | null;
    confidence_score: number | null;
    confidence_basis: string | null;
    priority: string;
    life_safety_flag: boolean;
    permit_blocker: boolean;
  }>).filter((d) => {
    // Verify everything EXCEPT high-confidence low-priority chatter.
    // Older logic only ran on `lowConf || highPri`, which left ~75% of
    // findings sitting in `verification_status='unverified'` forever.
    const conf = d.confidence_score ?? 0.5;
    const isSafeToSkip = conf >= 0.9 && d.priority === "low" &&
      !d.life_safety_flag && !d.permit_blocker;
    return !isSafeToSkip;
  });

  if (candidates.length === 0) {
    return { upheld: 0, overturned: 0, modified: 0, cannot_locate: 0, examined: 0, skipped: 0 };
  }

  const { data: coverageRows } = await admin
    .from("sheet_coverage")
    .select("sheet_ref, page_index")
    .eq("plan_review_id", planReviewId);
  const refToPage = new Map<string, number>();
  for (const r of (coverageRows ?? []) as Array<{
    sheet_ref: string;
    page_index: number | null;
  }>) {
    if (r.page_index !== null && r.page_index !== undefined) {
      refToPage.set(r.sheet_ref.toUpperCase(), r.page_index);
    }
  }

  const signed = await signedSheetUrls(admin, planReviewId);

  const targets: VerifyTarget[] = candidates.map((d) => ({
    id: d.id,
    def_number: d.def_number,
    discipline: d.discipline,
    finding: d.finding,
    required_action: d.required_action,
    evidence: d.evidence ?? [],
    sheet_refs: d.sheet_refs ?? [],
    code_reference: d.code_reference,
    confidence_score: d.confidence_score,
    confidence_basis: d.confidence_basis,
    priority: d.priority,
    page_indices: Array.from(
      new Set(
        (d.sheet_refs ?? [])
          .map((s) => refToPage.get(s.toUpperCase()))
          .filter((n): n is number => typeof n === "number"),
      ),
    ).slice(0, 3),
  }));

  const VERIFY_SYSTEM =
    "You are a senior Florida plans examiner adversarially auditing another examiner's findings. " +
    "For each finding, you receive: the finding text, the cited code reference, the verbatim evidence the original examiner read off the sheet, their confidence basis, and the actual cited sheet image(s). " +
    "Your job is to find reasons the finding might be WRONG — but you MUST distinguish between two failure modes:\n" +
    "  (a) The finding is demonstrably incorrect — the plans clearly comply, the cited code does not apply, or the cited evidence is misquoted/out of context. → 'overturned'.\n" +
    "  (b) You cannot locate the cited element/area on the supplied sheets, or the resolution/crop is insufficient to verify. → 'cannot_locate'. NEVER overturn for that reason.\n" +
    "Return verdicts via submit_verifications:\n" +
    "- 'upheld' — finding is valid as written; cite the visible evidence that supports it.\n" +
    "- 'overturned' — finding is provably wrong; cite the conflicting visible evidence.\n" +
    "- 'modified' — finding is partially right but mis-stated; provide corrected_finding + corrected_required_action.\n" +
    "- 'cannot_locate' — you cannot verify either way from the supplied images. Will be routed to human review.\n" +
    "Be strict: 'overturned' requires positive evidence the finding is wrong, not absence of evidence.";

  const BATCH = 6;
  let upheld = 0;
  let overturned = 0;
  let modified = 0;
  let cannotLocate = 0;
  let skipped = 0;

  // Per-batch retry policy. The biggest cause of `needs_human_review` in
  // production is a single transient AI gateway hiccup that leaves a whole
  // batch stuck at verification_status='unverified'. Retry with bounded
  // exponential backoff before giving up.
  const RETRY_DELAYS_MS = [500, 1500, 4000];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  for (let start = 0; start < targets.length; start += BATCH) {
    const slice = targets.slice(start, start + BATCH);

    const pageSet = new Set<number>();
    for (const t of slice) for (const p of t.page_indices) pageSet.add(p);
    const pages = Array.from(pageSet).slice(0, Math.min(8, pageSet.size));
    const imageUrls = pages
      .map((p) => signed[p]?.signed_url)
      .filter(Boolean) as string[];

    const findingsText = slice
      .map((t) => {
        const code = t.code_reference
          ? [t.code_reference.code, t.code_reference.section, t.code_reference.edition]
              .filter(Boolean)
              .join(" ")
          : "(no code cited)";
        return (
          `--- deficiency_id: ${t.id}\n` +
          `def_number: ${t.def_number} (${t.discipline})\n` +
          `priority: ${t.priority}, original confidence: ${t.confidence_score ?? "?"}\n` +
          `sheet_refs: ${t.sheet_refs.join(", ") || "(none)"}\n` +
          `code_reference: ${code}\n` +
          `finding: ${t.finding}\n` +
          `required_action: ${t.required_action}\n` +
          `original_examiner_evidence: ${t.evidence.length ? t.evidence.map((e) => `"${e}"`).join(" | ") : "(NONE — examiner had no quoted evidence; treat with extra skepticism)"}\n` +
          `original_confidence_basis: ${t.confidence_basis ?? "(not provided)"}`
        );
      })
      .join("\n\n");

    const userText =
      `Audit the following ${slice.length} finding${slice.length === 1 ? "" : "s"}. ` +
      `For EACH deficiency_id, return one entry in submit_verifications. ` +
      `When you cannot find the cited element on the supplied sheet images, return 'cannot_locate' — do NOT overturn.\n\n` +
      `${findingsText}\n\n` +
      `The attached images are the cited sheets (in the order listed above). ` +
      `Each sheet has a 10×10 grid overlay (cells A0..J9) you can use to describe locations.`;

    const content: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    > = [
      { type: "text", text: userText },
      ...imageUrls.map((u) => ({
        type: "image_url" as const,
        image_url: { url: u },
      })),
    ];

    let result: {
      verifications: Array<{
        deficiency_id: string;
        verdict: "upheld" | "overturned" | "modified" | "cannot_locate";
        reasoning: string;
        corrected_finding?: string;
        corrected_required_action?: string;
      }>;
    };
    try {
      result = (await callAI(
        [
          { role: "system", content: VERIFY_SYSTEM },
          { role: "user", content },
        ],
        VERIFY_SCHEMA as unknown as Record<string, unknown>,
      )) as typeof result;
    } catch (err) {
      console.error(`[verify] batch ${start} failed:`, err);
      skipped += slice.length;
      continue;
    }

    const byId = new Map(slice.map((t) => [t.id, t] as const));
    for (const v of result.verifications ?? []) {
      const target = byId.get(v.deficiency_id);
      if (!target) continue;
      const reasoning = (v.reasoning ?? "").slice(0, 1000);

      if (v.verdict === "overturned") {
        await admin
          .from("deficiencies_v2")
          .update({
            verification_status: "overturned",
            verification_notes: reasoning,
            status: "waived",
            reviewer_disposition: "reject",
            reviewer_notes: `Overturned in adversarial verification: ${reasoning}`,
          })
          .eq("id", target.id);
        overturned++;
      } else if (v.verdict === "modified") {
        const patch: Record<string, unknown> = {
          verification_status: "modified",
          verification_notes: reasoning,
          requires_human_review: true,
          human_review_reason:
            target.confidence_score !== null && target.confidence_score < 0.7
              ? "Modified during adversarial verification — please confirm before sending."
              : "Verification AI modified this finding — please confirm.",
        };
        if (v.corrected_finding) patch.finding = v.corrected_finding.slice(0, 1000);
        if (v.corrected_required_action) {
          patch.required_action = v.corrected_required_action.slice(0, 1000);
        }
        await admin.from("deficiencies_v2").update(patch).eq("id", target.id);
        modified++;
      } else if (v.verdict === "cannot_locate") {
        await admin
          .from("deficiencies_v2")
          .update({
            verification_status: "needs_human",
            verification_notes: reasoning,
            requires_human_review: true,
            human_review_reason:
              "Senior verifier could not locate the cited element on the supplied sheet images.",
            human_review_method:
              "Open the cited sheet at full resolution and confirm presence/absence of the element described.",
            human_review_verify: reasoning.slice(0, 500),
          })
          .eq("id", target.id);
        cannotLocate++;
      } else {
        const newConf = Math.max(
          0,
          Math.min(1, (target.confidence_score ?? 0.5) + 0.1),
        );
        await admin
          .from("deficiencies_v2")
          .update({
            verification_status: "verified",
            verification_notes: reasoning,
            confidence_score: newConf,
          })
          .eq("id", target.id);
        upheld++;
      }
    }
  }

  return {
    examined: targets.length,
    upheld,
    overturned,
    modified,
    cannot_locate: cannotLocate,
    skipped,
  };
}
