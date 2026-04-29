// Stage: complete.
// 1. Auto-attaches a page-level evidence crop URL to every finding that
//    doesn't have one, using sheet_refs[0] → plan_review_page_assets.storage_path.
//    A page thumbnail isn't a per-finding rectangle, but it's still verifiable
//    visual proof a building official can compare against the comment letter.
// 2. Marks the review complete (or `needs_human_review` if the defensibility
//    gates fail), snapshots the current sheet_map for round-over-round diffs,
//    and computes the legitimacy quality score shown on the review header.

import { createClient } from "../_shared/supabase.ts";
import { mergeProgress } from "../_shared/pipeline-status.ts";

async function attachPageThumbnailCrops(
  admin: ReturnType<typeof createClient>,
  planReviewId: string,
): Promise<{ attached: number; skipped: number }> {
  const { data: defsRaw } = await admin
    .from("deficiencies_v2")
    .select("id, sheet_refs, evidence_crop_url, evidence_crop_meta")
    .eq("plan_review_id", planReviewId)
    .is("evidence_crop_url", null);
  const defs = (defsRaw ?? []) as Array<{
    id: string;
    sheet_refs: string[] | null;
    evidence_crop_url: string | null;
    evidence_crop_meta: Record<string, unknown> | null;
  }>;
  if (defs.length === 0) return { attached: 0, skipped: 0 };

  const { data: assetsRaw } = await admin
    .from("plan_review_page_assets")
    .select("storage_path, page_index, sheet_ref")
    .eq("plan_review_id", planReviewId)
    .eq("status", "ready");
  const byRef = new Map<string, { storage_path: string; page_index: number | null }>();
  for (const a of (assetsRaw ?? []) as Array<{
    storage_path: string;
    page_index: number | null;
    sheet_ref: string | null;
  }>) {
    const key = (a.sheet_ref ?? "").toUpperCase().trim();
    if (key && !byRef.has(key)) {
      byRef.set(key, { storage_path: a.storage_path, page_index: a.page_index });
    }
  }

  let attached = 0;
  let skipped = 0;
  for (const d of defs) {
    const firstRef = (d.sheet_refs ?? [])[0]?.toUpperCase().trim();
    const hit = firstRef ? byRef.get(firstRef) : null;
    if (!hit) {
      skipped += 1;
      continue;
    }
    const meta = { ...(d.evidence_crop_meta ?? {}) } as Record<string, unknown>;
    meta.crop_kind = "page_thumbnail";
    meta.source_sheet_ref = firstRef;
    meta.source_page_index = hit.page_index;
    meta.attached_at = new Date().toISOString();
    await admin
      .from("deficiencies_v2")
      .update({
        evidence_crop_url: hit.storage_path,
        evidence_crop_meta: meta,
        updated_at: new Date().toISOString(),
      })
      .eq("id", d.id);
    attached += 1;
  }
  return { attached, skipped };
}

export async function stageComplete(
  admin: ReturnType<typeof createClient>,
  planReviewId: string,
) {
  // Pre-pass: attach a page thumbnail to every finding missing visual evidence
  // so the legitimacy "with_evidence_crop_pct" metric below reflects reality.
  const cropStats = await attachPageThumbnailCrops(admin, planReviewId);

  // Upstream-error gate: if verify or ground_citations errored, the findings
  // we have are not validated. Computing a quality score on top of un-grounded
  // findings produces a misleading "looks good — 3 findings" UX. Force the
  // run into needs_human_review with a precise blocker reason instead.
  const { data: upstreamRows } = await admin
    .from("review_pipeline_status")
    .select("stage, status, error_message, metadata")
    .eq("plan_review_id", planReviewId)
    .in("stage", ["verify", "ground_citations", "discipline_review"]);
  const failedUpstream = ((upstreamRows ?? []) as Array<{
    stage: string;
    status: string;
    error_message: string | null;
    metadata: Record<string, unknown> | null;
  }>).filter((r) => {
    if (r.status !== "error") return false;
    // Cancellations are a user choice, not a quality failure — don't gate on them.
    const cls = (r.metadata as { error_class?: string } | null)?.error_class;
    return cls !== "cancelled";
  });

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

  // Defensibility gate — verifier stalled, hallucinated citations remain, OR
  // an upstream verification stage errored.
  const upstreamFailed = failedUpstream.length > 0;
  const needsHumanReview = upstreamFailed || unverifiedPct > 0.25 || hasHallucinated;
  const aiCheckStatus = needsHumanReview ? "needs_human_review" : "complete";
  const blockerReason = needsHumanReview
    ? upstreamFailed
      ? `Upstream stage failed (${failedUpstream
          .map((r) => r.stage)
          .join(", ")}) — findings were not validated. Re-run before sending.`
      : unverifiedPct > 0.25
        ? `Verifier stalled — ${unverifiedCount} of ${live.length} findings never reached a verdict.`
        : "Hallucinated FBC citations remain. Triage before this can be marked complete."
    : null;

  const { data: existing } = await admin
    .from("plan_reviews")
    .select("checklist_state")
    .eq("id", planReviewId)
    .maybeSingle();
  const prevState = ((existing?.checklist_state ?? {}) as Record<string, unknown>) ?? {};

  // Atomic JSONB merge for the quality breakdown so a late discipline_review
  // chunk beacon can't accidentally erase the score we just computed.
  await mergeProgress(admin, planReviewId, {
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
  });

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
      updated_at: new Date().toISOString(),
    })
    .eq("id", planReviewId);

  // Phase 5 telemetry: persist a quality event so we can chart trends and
  // catch regressions across runs (independent of any per-review banner).
  const hallucinatedCount = live.filter((d) => d.citation_status === "hallucinated").length;
  await admin.from("pipeline_quality_events").insert({
    plan_review_id: planReviewId,
    ai_check_status: aiCheckStatus,
    quality_score: qualityScore,
    unverified_pct: Math.round(unverifiedPct * 100),
    hallucinated_count: hallucinatedCount,
    total_live_findings: live.length,
    blocker_reason: blockerReason,
  });
  return {
    ok: true,
    snapshot_size: snapshot.length,
    quality_score: qualityScore,
    ai_check_status: aiCheckStatus,
    blocker_reason: blockerReason,
    crops_attached: cropStats.attached,
    crops_skipped: cropStats.skipped,
  };
}
