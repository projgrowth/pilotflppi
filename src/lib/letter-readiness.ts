/**
 * Computes the "letter readiness" checklist shown above the Send/Export
 * actions on the Review Dashboard. Pure function — takes raw rows in,
 * returns a list of checks the UI renders. No I/O, no React.
 *
 * Required checks (must all be green to enable Mark Sent without override):
 *   1. Triage complete       — every live finding has a reviewer_disposition.
 *   2. Citations grounded    — no findings with citation_status="unverified" AND confidence_score < 0.7.
 *   3. Sheet refs resolved   — no open findings whose evidence_crop_meta.unresolved_sheet === true.
 *   4. QC sign-off           — qc_status === "qc_approved" (suppressed if reviewer is sole signer).
 *
 * Advisory check (amber but non-blocking):
 *   5. Project DNA complete  — project_dna.missing_fields is empty.
 *
 * The reviewer can override gating via "Send anyway" in the UI; that override
 * is logged with a typed reason and persisted in the snapshot's
 * `override_reasons` column for downstream audit.
 */

import type { DeficiencyV2Row } from "@/hooks/useReviewDashboard";

export type ReadinessSeverity = "ok" | "warn" | "block";

export interface ReadinessCheck {
  id:
    | "triage"
    | "citations"
    | "sheet_refs"
    | "qc"
    | "project_dna";
  severity: ReadinessSeverity;
  /** Required vs advisory — only required checks gate the export button. */
  required: boolean;
  title: string;
  detail: string;
  /** Optional first finding id we'd jump to when the reviewer clicks "Fix". */
  jumpFindingId?: string;
}

export interface ReadinessInput {
  findings: Pick<
    DeficiencyV2Row,
    | "id"
    | "reviewer_disposition"
    | "status"
    | "verification_status"
    | "citation_status"
    | "confidence_score"
    | "evidence_crop_meta"
  >[];
  qcStatus: string | null | undefined;
  /** True when the dashboard reviewer is the same person who ran the AI check.
   *  In single-reviewer firms there is no second pair of eyes to QC, so we
   *  surface qc as a warn instead of a block. */
  reviewerIsSoleSigner: boolean;
  projectDnaMissingFields: string[] | null | undefined;
}

export interface ReadinessResult {
  checks: ReadinessCheck[];
  /** True iff every required check is "ok". */
  allRequiredPassing: boolean;
  /** Count of required checks currently failing. */
  blockingCount: number;
}

const LIVE_STATUSES = new Set(["open", "needs_info"]);

export function computeLetterReadiness(input: ReadinessInput): ReadinessResult {
  const checks: ReadinessCheck[] = [];

  // Filter to findings still "in play" — resolved/waived shouldn't gate the letter.
  const live = input.findings.filter(
    (f) =>
      LIVE_STATUSES.has(f.status) &&
      f.verification_status !== "superseded" &&
      f.verification_status !== "overturned",
  );

  // 1. Triage complete
  const untriaged = live.filter((f) => f.reviewer_disposition === null);
  checks.push({
    id: "triage",
    required: true,
    severity: untriaged.length === 0 ? "ok" : "block",
    title:
      untriaged.length === 0
        ? "All findings triaged"
        : `${untriaged.length} finding${untriaged.length === 1 ? "" : "s"} still need a decision`,
    detail:
      untriaged.length === 0
        ? "Every live finding has been confirmed, rejected, or modified."
        : "Each finding must be marked confirm / reject / modify before sending.",
    jumpFindingId: untriaged[0]?.id,
  });

  // 2. Citations grounded — only block on the truly weak ones.
  const weakCitations = live.filter(
    (f) =>
      (f.citation_status ?? "unverified") === "unverified" &&
      typeof f.confidence_score === "number" &&
      f.confidence_score < 0.7,
  );
  checks.push({
    id: "citations",
    required: true,
    severity: weakCitations.length === 0 ? "ok" : "block",
    title:
      weakCitations.length === 0
        ? "Citations look defensible"
        : `${weakCitations.length} ungrounded low-confidence citation${weakCitations.length === 1 ? "" : "s"}`,
    detail:
      weakCitations.length === 0
        ? "No findings combine an unverified FBC citation with low AI confidence."
        : "These cite an FBC section the system couldn't ground AND scored under 0.7. Verify them by hand or remove from the letter.",
    jumpFindingId: weakCitations[0]?.id,
  });

  // 3. Sheet refs resolved — Track-2 metadata flag.
  const unresolvedSheets = live.filter((f) => {
    const meta = (f.evidence_crop_meta ?? {}) as Record<string, unknown>;
    return meta.unresolved_sheet === true;
  });
  checks.push({
    id: "sheet_refs",
    required: true,
    severity: unresolvedSheets.length === 0 ? "ok" : "block",
    title:
      unresolvedSheets.length === 0
        ? "All sheet references resolved"
        : `${unresolvedSheets.length} finding${unresolvedSheets.length === 1 ? "" : "s"} reference an unknown sheet`,
    detail:
      unresolvedSheets.length === 0
        ? "Every finding maps to a real page in the uploaded plan set."
        : "These cite a sheet number that isn't in the uploaded set. Fix the citation or attach the missing sheet before sending.",
    jumpFindingId: unresolvedSheets[0]?.id,
  });

  // 4. QC sign-off — required for multi-reviewer firms, advisory otherwise.
  const qcOk = (input.qcStatus ?? "pending_qc") === "qc_approved";
  checks.push({
    id: "qc",
    required: !input.reviewerIsSoleSigner,
    severity: qcOk
      ? "ok"
      : input.reviewerIsSoleSigner
        ? "warn"
        : "block",
    title: qcOk
      ? "QC sign-off complete"
      : input.reviewerIsSoleSigner
        ? "Single-reviewer firm — no second QC available"
        : "Awaiting QC sign-off",
    detail: qcOk
      ? "A second team member has reviewed and approved this letter."
      : input.reviewerIsSoleSigner
        ? "FS 553.791 prefers a separate QC reviewer. Acknowledged for solo firms."
        : "A different team member (not the original reviewer) must approve QC before this letter can be sent.",
  });

  // 5. Project DNA completeness — advisory only.
  const missing = input.projectDnaMissingFields ?? [];
  checks.push({
    id: "project_dna",
    required: false,
    severity: missing.length === 0 ? "ok" : "warn",
    title:
      missing.length === 0
        ? "Project intake complete"
        : `${missing.length} project field${missing.length === 1 ? "" : "s"} missing`,
    detail:
      missing.length === 0
        ? "Occupancy, construction type, jurisdiction, and code edition all extracted."
        : `Missing: ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? "…" : ""}. The letter will still send but some boilerplate may be incomplete.`,
  });

  const required = checks.filter((c) => c.required);
  const blockingCount = required.filter((c) => c.severity === "block").length;
  return {
    checks,
    allRequiredPassing: blockingCount === 0,
    blockingCount,
  };
}
