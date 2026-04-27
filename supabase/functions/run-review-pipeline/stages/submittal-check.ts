// stages/submittal-check.ts — submittal completeness gate.
//
// Run BEFORE DNA / discipline review. If a commercial set has zero sheets
// for a required trade (Structural / MEP / Civil / Fire Protection) we
// raise ONE permit-blocker finding instead of letting discipline_review
// burn dozens of arch-only findings against an obviously incomplete set.

import type { Admin } from "../_shared/supabase.ts";

export async function stageSubmittalCheck(
  admin: Admin,
  planReviewId: string,
  firmId: string | null,
) {
  const { data: prRow } = await admin
    .from("plan_reviews")
    .select("ai_run_progress, firm_id, projects(use_type)")
    .eq("id", planReviewId)
    .maybeSingle();
  const progress = ((prRow?.ai_run_progress ?? {}) as Record<string, unknown>) ?? {};
  if (progress.submittal_check_at) {
    return { reused: true, submittal_incomplete: !!progress.submittal_incomplete };
  }
  const useType =
    (prRow as { projects?: { use_type?: string | null } | null } | null)
      ?.projects?.use_type ?? null;
  const resolvedFirmId =
    firmId ?? ((prRow as { firm_id?: string | null } | null)?.firm_id ?? null);

  const { data: coverage } = await admin
    .from("sheet_coverage")
    .select("discipline")
    .eq("plan_review_id", planReviewId)
    .eq("status", "present");

  const counts = new Map<string, number>();
  for (const row of (coverage ?? []) as Array<{ discipline: string | null }>) {
    const d = (row.discipline ?? "General").trim();
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const totalSheets = Array.from(counts.values()).reduce((a, b) => a + b, 0);

  const writeProgress = async (extra: Record<string, unknown>) => {
    await admin
      .from("plan_reviews")
      .update({
        ai_run_progress: {
          ...progress,
          submittal_check_at: new Date().toISOString(),
          ...extra,
        },
      })
      .eq("id", planReviewId);
  };

  if (useType === "residential" || totalSheets < 6) {
    await writeProgress({
      submittal_incomplete: false,
      submittal_check_reason: "skipped_residential_or_small",
    });
    return { skipped: true, total_sheets: totalSheets };
  }

  const expected = [
    { label: "Structural", matchAny: ["Structural"] },
    { label: "MEP / Mechanical / Electrical / Plumbing", matchAny: ["MEP"] },
    { label: "Civil / Site", matchAny: ["Civil"] },
    { label: "Fire Protection", matchAny: ["Fire Protection", "Life Safety"] },
  ];
  const missing = expected.filter(
    (e) => !e.matchAny.some((d) => (counts.get(d) ?? 0) > 0),
  );
  const presentSummary = Array.from(counts.entries())
    .map(([d, n]) => `${d} (${n})`)
    .join(", ");
  const presentList = Array.from(counts.entries()).map(([d, n]) => ({
    discipline: d,
    sheets: n,
  }));

  if (missing.length === 0) {
    await writeProgress({
      submittal_incomplete: false,
      submittal_disciplines_present: presentList,
    });
    return { complete: true, total_sheets: totalSheets };
  }

  const missingLabels = missing.map((m) => m.label).join(", ");
  await admin.from("deficiencies_v2").upsert(
    {
      plan_review_id: planReviewId,
      firm_id: resolvedFirmId,
      def_number: "DEF-SUB001",
      discipline: "General",
      sheet_refs: [],
      code_reference: { code: "FBC", section: "107.2.1", edition: "8th" },
      finding:
        `Submittal appears incomplete for permit. The uploaded set contains ${totalSheets} sheet(s) covering: ${presentSummary}. ` +
        `The following discipline(s) typical for commercial permits were NOT found in the upload: ${missingLabels}. ` +
        `Confirm with the design team whether the missing trades will be submitted under separate cover or whether this submittal should be returned as incomplete.`,
      required_action:
        `Either (a) request the missing discipline drawings (${missingLabels}) before continuing review, ` +
        `or (b) confirm in writing that the missing trades are deferred and document the deferral in the comment letter. ` +
        `If proceeding with review of the partial set, the comment letter must explicitly state that this review covers only the disciplines provided.`,
      evidence: [`Sheet inventory: ${presentSummary}`],
      priority: "high",
      life_safety_flag: false,
      permit_blocker: true,
      liability_flag: true,
      requires_human_review: true,
      human_review_reason:
        "Missing-trade detection is heuristic — verify the contractor isn't sending the other trades under a separate permit number before rejecting.",
      human_review_verify:
        "Check project intake notes / contractor email for any reference to a deferred submittal or separate permit application.",
      confidence_score: 0.95,
      confidence_basis: "Deterministic — based on sheet_coverage discipline counts after sheet_map.",
      status: "open",
      verification_status: "unverified",
      citation_status: "unverified",
    },
    { onConflict: "plan_review_id,def_number" },
  );

  await writeProgress({
    submittal_incomplete: true,
    submittal_missing_disciplines: missing.map((m) => m.label),
    submittal_disciplines_present: presentList,
  });

  return {
    complete: false,
    total_sheets: totalSheets,
    missing: missing.map((m) => m.label),
  };
}
