/**
 * Server-trip helper that builds a `ReadinessResult` for a plan review
 * directly from `deficiencies_v2` + the plan_reviews row, then runs the same
 * pure `computeLetterReadiness` the dashboard banner uses.
 *
 * Why this exists: the legacy PlanReviewDetail page renders a slimmed-down
 * `Finding` shape that doesn't carry the verifier / citation / evidence-meta
 * columns the readiness checker needs. Rather than thread those columns
 * through every layer just for the Send action, we re-fetch the minimum set
 * at click-time. One round-trip, identical inputs to the dashboard gate, so
 * the snapshot stored alongside the letter stays consistent.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  computeLetterReadiness,
  type ReadinessResult,
} from "@/lib/letter-readiness";

export async function fetchReadinessForSend(args: {
  planReviewId: string;
  qcStatus: string | null | undefined;
  noticeFiledAt: string | null | undefined;
  affidavitSignedAt: string | null | undefined;
  isThresholdBuilding: boolean;
  thresholdTriggers: string[];
  specialInspectorDesignated: boolean;
  reviewerLicensedDisciplines: string[];
  projectDnaMissingFields: string[];
  /** Wave 6: DNA coastal flag + whether the county registry already covers it. */
  dnaIsCoastal?: boolean | null;
  countyAlreadyCoastal?: boolean;
}): Promise<ReadinessResult> {
  const [{ data: rows }, { data: cov }, { data: firmRow }] = await Promise.all([
    supabase
      .from("deficiencies_v2")
      .select(
        "id,reviewer_disposition,reviewer_disposition_at,updated_at,status,verification_status,citation_status,confidence_score,evidence_crop_meta,discipline",
      )
      .eq("plan_review_id", args.planReviewId)
      .limit(2000),
    supabase
      .from("review_coverage")
      .select("sheets_reviewed, sheets_total")
      .eq("plan_review_id", args.planReviewId)
      .maybeSingle(),
    supabase
      .from("firm_settings")
      .select("block_letter_on_low_coverage, block_letter_on_ungrounded")
      .maybeSingle(),
  ]);

  const findings = (rows ?? []) as Array<{
    id: string;
    reviewer_disposition: string | null;
    reviewer_disposition_at: string | null;
    updated_at: string | null;
    status: string;
    verification_status: string;
    citation_status: string;
    confidence_score: number | null;
    evidence_crop_meta: Record<string, unknown> | null;
    discipline: string | null;
  }>;

  const disciplinesInLetter = Array.from(
    new Set(
      findings
        .filter((f) => f.status === "open" || f.status === "needs_info")
        .map((f) => (f.discipline ?? "").toLowerCase())
        .filter(Boolean),
    ),
  );

  const coveragePct =
    cov && cov.sheets_total
      ? Math.min(100, Math.round((cov.sheets_reviewed / cov.sheets_total) * 100))
      : null;

  return computeLetterReadiness({
    findings: findings as unknown as Parameters<typeof computeLetterReadiness>[0]["findings"],
    qcStatus: args.qcStatus,
    reviewerIsSoleSigner: true, // matches ReviewDashboard default
    projectDnaMissingFields: args.projectDnaMissingFields,
    noticeToBuildingOfficialFiledAt: args.noticeFiledAt,
    complianceAffidavitSignedAt: args.affidavitSignedAt,
    disciplinesInLetter,
    reviewerLicensedDisciplines: args.reviewerLicensedDisciplines,
    isThresholdBuilding: args.isThresholdBuilding,
    thresholdTriggers: args.thresholdTriggers,
    specialInspectorDesignated: args.specialInspectorDesignated,
    coveragePct,
    blockLetterOnLowCoverage: firmRow?.block_letter_on_low_coverage ?? true,
    blockLetterOnUngrounded: firmRow?.block_letter_on_ungrounded ?? true,
    dnaIsCoastal: args.dnaIsCoastal ?? null,
    countyAlreadyCoastal: args.countyAlreadyCoastal ?? false,
  });
}
