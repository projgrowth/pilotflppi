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
    | "project_dna"
    | "notice_filed"
    | "affidavit_signed"
    | "reviewer_licensed"
    | "threshold_special_inspector";
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
  /** F.S. 553.791(4)(a): Notice to Building Official must be filed before
   *  the private provider's review for this round can be sent to the AHJ. */
  noticeToBuildingOfficialFiledAt: string | null | undefined;
  /** F.S. 553.791(7)(b): a signed Plan Compliance Affidavit must accompany
   *  every plan submittal — round-scoped. */
  complianceAffidavitSignedAt: string | null | undefined;
  /** Disciplines present on live findings (lowercase, e.g. "structural"). */
  disciplinesInLetter: string[];
  /** Disciplines the signing reviewer is licensed for (lowercase keys
   *  from profiles.discipline_licenses). Empty array = no licenses on file. */
  reviewerLicensedDisciplines: string[];
  /** F.S. 553.79(5): true when DNA detected the project meets the threshold-
   *  building definition (>3 stories, >50 ft, or >5,000 sf assembly w/ >500 occ). */
  isThresholdBuilding: boolean;
  /** Triggers that classified the project as a threshold building, for the UI detail. */
  thresholdTriggers: string[];
  /** Has the EOR designated a Special Inspector for this threshold building? */
  specialInspectorDesignated: boolean;
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

  // 2. Citations grounded — block on (a) hallucinated citations OR
  //    (b) unverified+low-confidence combos. Hallucinated citations are
  //    ALWAYS a hard block.
  const hallucinated = live.filter((f) => f.citation_status === "hallucinated");
  const NON_BLOCKING = new Set([
    "verified",
    "verified_stub",
    "no_citation_required",
    "mismatch",
    "not_found",
  ]);
  const weakCitations = live.filter(
    (f) =>
      !NON_BLOCKING.has(f.citation_status ?? "unverified") &&
      (f.citation_status ?? "unverified") === "unverified" &&
      typeof f.confidence_score === "number" &&
      f.confidence_score < 0.7,
  );
  const unverified = live.filter(
    (f) => (f.verification_status ?? "unverified") === "unverified",
  );
  const unverifiedPct = live.length === 0 ? 0 : unverified.length / live.length;
  const verifierStalled = unverifiedPct > 0.25;

  const citationProblems = hallucinated.length + weakCitations.length;
  checks.push({
    id: "citations",
    required: true,
    severity: citationProblems === 0 ? "ok" : "block",
    title:
      citationProblems === 0
        ? "Citations look defensible"
        : hallucinated.length > 0
          ? `${hallucinated.length} hallucinated citation${hallucinated.length === 1 ? "" : "s"}${weakCitations.length ? ` + ${weakCitations.length} weak` : ""}`
          : `${weakCitations.length} ungrounded low-confidence citation${weakCitations.length === 1 ? "" : "s"}`,
    detail:
      citationProblems === 0
        ? "No findings combine an unverified FBC citation with low AI confidence, and no hallucinated citations remain."
        : hallucinated.length > 0
          ? "These cite an FBC section the system could not parse. Fix or remove them before sending."
          : "These cite an FBC section the system couldn't ground AND scored under 0.7. Verify by hand or remove.",
    jumpFindingId: hallucinated[0]?.id ?? weakCitations[0]?.id,
  });

  // 2b. Verifier completion — required check (two-pair-of-eyes promise).
  checks.push({
    id: "citations",
    required: true,
    severity: verifierStalled ? "block" : "ok",
    title: verifierStalled
      ? `${unverified.length} of ${live.length} findings never reached the verifier (${Math.round(unverifiedPct * 100)}%)`
      : "Adversarial verifier ran on every finding",
    detail: verifierStalled
      ? "Re-run Deep QA, or triage the unverified items by hand before sending."
      : `${live.length - unverified.length} of ${live.length} findings have a verifier verdict.`,
    jumpFindingId: unverified[0]?.id,
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

  // 6. Notice to Building Official filed (F.S. 553.791(4)(a)) — required.
  const noticeFiled = !!input.noticeToBuildingOfficialFiledAt;
  checks.push({
    id: "notice_filed",
    required: true,
    severity: noticeFiled ? "ok" : "block",
    title: noticeFiled
      ? "Notice to Building Official on file"
      : "Notice to Building Official not filed",
    detail: noticeFiled
      ? `Filed ${new Date(input.noticeToBuildingOfficialFiledAt!).toLocaleDateString()}. F.S. 553.791(4)(a) prerequisite met.`
      : "F.S. 553.791(4)(a) requires the Notice to be on file with the AHJ before the private provider's review is delivered. Generate it from Documents and mark it filed.",
  });

  // 7. Plan Compliance Affidavit signed for this round (F.S. 553.791(7)(b)).
  const affidavitSigned = !!input.complianceAffidavitSignedAt;
  checks.push({
    id: "affidavit_signed",
    required: true,
    severity: affidavitSigned ? "ok" : "block",
    title: affidavitSigned
      ? "Plan Compliance Affidavit signed"
      : "Plan Compliance Affidavit not signed for this round",
    detail: affidavitSigned
      ? `Signed ${new Date(input.complianceAffidavitSignedAt!).toLocaleDateString()}. Required to accompany the submittal.`
      : "F.S. 553.791(7)(b) requires a signed affidavit with every plan submittal. Generate from Documents and mark it signed.",
  });

  // 8. Reviewer license coverage — block when a discipline in the letter has
  // no matching professional license on the signing reviewer's profile.
  // Cross-discipline / administrative findings are intentionally excluded —
  // they are documentation flags, not engineering judgments.
  const NON_DISCIPLINE = new Set(["cross_sheet", "administrative", "general"]);
  const licensed = new Set(
    (input.reviewerLicensedDisciplines ?? []).map((d) => d.toLowerCase()),
  );
  const uncovered = (input.disciplinesInLetter ?? [])
    .map((d) => d.toLowerCase())
    .filter((d) => d && !NON_DISCIPLINE.has(d) && !licensed.has(d));
  const uniqueUncovered = Array.from(new Set(uncovered));
  checks.push({
    id: "reviewer_licensed",
    required: true,
    severity: uniqueUncovered.length === 0 ? "ok" : "block",
    title:
      uniqueUncovered.length === 0
        ? "Reviewer licensed for every discipline in the letter"
        : `Reviewer not licensed for ${uniqueUncovered.length} discipline${uniqueUncovered.length === 1 ? "" : "s"}`,
    detail:
      uniqueUncovered.length === 0
        ? "F.S. 553.791(2) requires the signing reviewer to hold the appropriate Florida professional license for each discipline reviewed."
        : `Add a license number under your profile for: ${uniqueUncovered.join(", ")}. Until then this letter cannot be sent under your signature.`,
  });

  // 9. Threshold building Special Inspector (F.S. 553.79(5)) — required when
  // DNA classified the project as a threshold building. Florida law requires
  // the EOR to designate a Special Inspector for these projects; without it,
  // the private provider cannot recommend permit issuance.
  if (input.isThresholdBuilding) {
    const ok = input.specialInspectorDesignated;
    const triggers = input.thresholdTriggers.length > 0
      ? input.thresholdTriggers.join("; ")
      : "DNA threshold thresholds met";
    checks.push({
      id: "threshold_special_inspector",
      required: true,
      severity: ok ? "ok" : "block",
      title: ok
        ? "Threshold building — Special Inspector on record"
        : "Threshold building — Special Inspector not designated",
      detail: ok
        ? `F.S. 553.79(5) Special Inspector designation recorded. Triggers: ${triggers}.`
        : `F.S. 553.79(5) requires the Engineer of Record to designate a Special Inspector for threshold buildings. Triggers: ${triggers}. Record the designation under the Statutory Compliance panel.`,
    });
  }

  const required = checks.filter((c) => c.required);
  const blockingCount = required.filter((c) => c.severity === "block").length;
  return {
    checks,
    allRequiredPassing: blockingCount === 0,
    blockingCount,
  };
}
