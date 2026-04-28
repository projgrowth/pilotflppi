// Stage: complete.
// Marks the review complete, snapshots the current sheet_map into
// checklist_state.last_sheet_map so the NEXT round's discipline_review can
// diff against it and skip unchanged sheets.

import { createClient } from "../_shared/supabase.ts";

export async function stageComplete(
  admin: ReturnType<typeof createClient>,
  planReviewId: string,
) {
  const { data: sheetRows } = await admin
    .from("sheet_coverage")
    .select("sheet_ref, page_index, discipline")
    .eq("plan_review_id", planReviewId);
  const snapshot = (sheetRows ?? []) as Array<{
    sheet_ref: string;
    page_index: number | null;
    discipline: string | null;
  }>;

  // Compute a 0–100 quality score so reviewers can see at a glance
  // whether this AI run is trustworthy or needs heavy spot-checking.
  const { data: defs } = await admin
    .from("deficiencies_v2")
    .select("citation_status, verification_status, evidence_crop_url, reviewer_disposition")
    .eq("plan_review_id", planReviewId)
    .neq("status", "waived")
    .neq("status", "resolved");
  const live = (defs ?? []) as Array<{
    citation_status: string | null;
    verification_status: string | null;
    evidence_crop_url: string | null;
    reviewer_disposition: string | null;
  }>;
  const total = live.length || 1;
  const verifiedCit = live.filter((d) => d.citation_status === "verified").length / total;
  const verifiedVer = live.filter((d) =>
    d.verification_status === "verified" || d.verification_status === "modified"
  ).length / total;
  const withCrop = live.filter((d) => !!d.evidence_crop_url).length / total;
  const hasHallucinated = live.some((d) => d.citation_status === "hallucinated");
  const unverifiedCount = live.filter(
    (d) => (d.verification_status ?? "unverified") === "unverified",
  ).length;
  const unverifiedPct = unverifiedCount / total;
  let qualityScore = 0;
  if (verifiedCit >= 0.8) qualityScore += 30;
  if (verifiedVer >= 0.8) qualityScore += 30;
  if (withCrop >= 0.8) qualityScore += 20;
  if (!hasHallucinated) qualityScore += 20;

  // Defensibility gate — verifier stalled or hallucinated citations remain.
  const needsHumanReview = unverifiedPct > 0.25 || hasHallucinated;
  const aiCheckStatus = needsHumanReview ? "needs_human_review" : "complete";
  const blockerReason = needsHumanReview
    ? unverifiedPct > 0.25
      ? `Verifier stalled — ${unverifiedCount} of ${live.length} findings never reached a verdict.`
      : "Hallucinated FBC citations remain. Triage before this can be marked complete."
    : null;

  const { data: existing } = await admin
    .from("plan_reviews")
    .select("ai_run_progress, checklist_state")
    .eq("id", planReviewId)
    .maybeSingle();
  const prevState = ((existing?.checklist_state ?? {}) as Record<string, unknown>) ?? {};
  const prevProgress = ((existing?.ai_run_progress ?? {}) as Record<string, unknown>) ?? {};

  await admin
    .from("plan_reviews")
    .update({
      ai_check_status: aiCheckStatus,
      pipeline_version: "v2",
      checklist_state: {
        ...prevState,
        last_sheet_map: snapshot,
        last_sheet_map_at: new Date().toISOString(),
      },
      ai_run_progress: {
        ...prevProgress,
        quality_score: qualityScore,
        quality_breakdown: {
          verified_citations_pct: Math.round(verifiedCit * 100),
          verified_findings_pct: Math.round(verifiedVer * 100),
          with_evidence_crop_pct: Math.round(withCrop * 100),
          has_hallucinated_citations: hasHallucinated,
          unverified_pct: Math.round(unverifiedPct * 100),
          total_live_findings: live.length,
          blocker_reason: blockerReason,
        },
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", planReviewId);
  return {
    ok: true,
    snapshot_size: snapshot.length,
    quality_score: qualityScore,
    ai_check_status: aiCheckStatus,
    blocker_reason: blockerReason,
  };
}
