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
    | "verifier_completion"
    | "verifier_cannot_locate"
    | "sheet_refs"
    | "qc"
    | "project_dna"
    | "notice_filed"
    | "affidavit_signed"
    | "reviewer_licensed"
    | "threshold_special_inspector"
    | "coverage"
    | "coastal_overlay"
    | "stale_disposition";
  severity: ReadinessSeverity;
  /** Required vs advisory — only required checks gate the export button. */
  required: boolean;
  title: string;
  detail: string;
  /** Optional first finding id we'd jump to when the reviewer clicks "Fix". */
  jumpFindingId?: string;
}

export interface ReadinessInput {
  findings: (Pick<
    DeficiencyV2Row,
    | "id"
    | "reviewer_disposition"
    | "status"
    | "verification_status"
    | "citation_status"
    | "confidence_score"
    | "evidence_crop_meta"
  > & {
    /** Optional — populated by `tr_stamp_reviewer_disposition_at`. When the
     *  finding's `updated_at` is later than this, the human decision is
     *  stale (the finding changed after they decided). */
    reviewer_disposition_at?: string | null;
    updated_at?: string | null;
  })[];
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
  /** Sheet-coverage percentage (0-100): % of expected sheets that were
   *  reviewed by every required discipline. Below 100 = some sheets weren't
   *  examined. Used by the coverage gate when firm settings opt in. */
  coveragePct?: number | null;
  /** Firm setting: block the letter when coverage_pct < 100. */
  blockLetterOnLowCoverage?: boolean;
  /**
   * Firm setting: block the letter when any live finding has a
   * `verified_stub` citation (real FBC section, but no canonical text seeded
   * yet — so the AI can't prove the citation actually supports the finding).
   *
   * **Default behavior is BLOCKING.** The check uses `!== false` so that a
   * `null`/`undefined`/missing firm setting (every brand-new firm row) keeps
   * the conservative gate in place. Pass an explicit `false` to opt out.
   *
   * Audit H-02 noted the flag name is ambiguous (the boolean value `true`
   * means "DO block"). Renaming the column requires a coordinated migration
   * + value-flip; until then, do NOT toggle this in the UI without copy
   * that explicitly says "block the letter when…" so reviewers don't
   * accidentally let stub citations through.
   */
  blockLetterOnUngrounded?: boolean;
  /**
   * Audit M-04 follow-up: when DNA flags `is_coastal=true` but the project's
   * county is classified inland in `county-requirements/data.ts` (no
   * `windBorneDebrisRegion` and no `floodZoneRequired`), surface a blocking
   * check so the reviewer knows WBDR + flood callouts are missing from the
   * boilerplate. Pass `null`/`undefined` to skip the check entirely.
   */
  dnaIsCoastal?: boolean | null;
  /** True when the project's county registry entry covers WBDR + flood. */
  countyAlreadyCoastal?: boolean;
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

  // 2. Citations grounded — block on:
  //   (a) hallucinated citations (always — fabricated section numbers),
  //   (b) mismatch / not_found citations that the reviewer hasn't dispositioned
  //       (these are real risk: section exists but wording diverges, or section
  //       isn't in the FBC index at all),
  //   (c) verified_stub when the firm opts in,
  //   (d) unverified + low-confidence combos.
  // A finding with a non-null reviewer_disposition is treated as "the human
  // has decided" — they accepted, waived, or rewrote. We trust that and don't
  // block on the AI's grade anymore.
  const hallucinated = live.filter((f) => f.citation_status === "hallucinated");
  const undecided = (f: { reviewer_disposition: string | null }) =>
    f.reviewer_disposition === null;
  const undecidedMismatch = live.filter(
    (f) => f.citation_status === "mismatch" && undecided(f),
  );
  const undecidedNotFound = live.filter(
    (f) => f.citation_status === "not_found" && undecided(f),
  );
  // verified_stub becomes blocking when the firm setting is on (default true).
  const blockStubs = input.blockLetterOnUngrounded !== false;
  const stubCitations = blockStubs
    ? live.filter((f) => f.citation_status === "verified_stub" && undecided(f))
    : [];
  const weakCitations = live.filter(
    (f) =>
      (f.citation_status ?? "unverified") === "unverified" &&
      typeof f.confidence_score === "number" &&
      f.confidence_score < 0.7 &&
      undecided(f),
  );
  const undecidedTotal =
    undecidedMismatch.length + undecidedNotFound.length;
  // Unverified % — exclude findings whose citation is hallucinated (those
  // are auto-waived by the pipeline; if any slip through, the human can't
  // meaningfully verify them so they shouldn't trigger the "verifier stalled"
  // gate). Also exclude `needs_human` (the verifier DID return — it just
  // bounced to a human review).
  const unverified = live.filter(
    (f) =>
      (f.verification_status ?? "unverified") === "unverified" &&
      f.citation_status !== "hallucinated",
  );
  const unverifiedPct = live.length === 0 ? 0 : unverified.length / live.length;
  // Stall threshold: >25% truly unverified, AND at least 4 findings to avoid
  // tiny-review false positives (1/3 = 33% wouldn't trigger).
  const verifierStalled = unverifiedPct > 0.25 && live.length >= 4;

  const citationProblems =
    hallucinated.length + weakCitations.length + stubCitations.length + undecidedTotal;
  checks.push({
    id: "citations",
    required: true,
    severity: citationProblems === 0 ? "ok" : "block",
    title:
      citationProblems === 0
        ? "Citations look defensible"
        : hallucinated.length > 0
          ? `${hallucinated.length} hallucinated citation${hallucinated.length === 1 ? "" : "s"}${
              undecidedTotal + weakCitations.length + stubCitations.length > 0
                ? ` + ${undecidedTotal + weakCitations.length + stubCitations.length} ungrounded`
                : ""
            }`
          : undecidedTotal > 0
            ? `${undecidedTotal} citation${undecidedTotal === 1 ? "" : "s"} need a reviewer decision (mismatch / not in DB)`
            : stubCitations.length > 0
              ? `${stubCitations.length} citation${stubCitations.length === 1 ? "" : "s"} reference an FBC stub (no canonical text)`
              : `${weakCitations.length} ungrounded low-confidence citation${weakCitations.length === 1 ? "" : "s"}`,
    detail:
      citationProblems === 0
        ? "No findings combine an unverified FBC citation with low AI confidence, no hallucinated citations remain, and every grounded section has full canonical text."
        : hallucinated.length > 0
          ? "These cite an FBC section the system could not parse. Fix or remove them before sending."
          : undecidedTotal > 0
            ? "Mismatch / not-in-DB citations need a reviewer decision (confirm, modify, or reject) before sending. Use 'Re-ground' on the finding card to retry, or accept it manually."
            : stubCitations.length > 0
              ? "These cite real FBC sections, but the canonical requirement text isn't seeded yet — so the AI can't prove the citation actually supports the finding. Verify by hand or remove."
              : "These cite an FBC section the system couldn't ground AND scored under 0.7. Verify by hand or remove.",
    jumpFindingId:
      hallucinated[0]?.id ??
      undecidedMismatch[0]?.id ??
      undecidedNotFound[0]?.id ??
      stubCitations[0]?.id ??
      weakCitations[0]?.id,
  });

  // 2b. Verifier completion — required check (two-pair-of-eyes promise).
  checks.push({
    id: "verifier_completion",
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

  // 10. Sheet coverage — block when not every sheet was reviewed by every
  // required discipline (firm setting, default on). Coverage < 100% means
  // we'd be sending a letter with blind spots.
  const coverageGateOn = input.blockLetterOnLowCoverage !== false;
  if (coverageGateOn && typeof input.coveragePct === "number") {
    const pct = input.coveragePct;
    const covOk = pct >= 100;
    checks.push({
      id: "coverage",
      required: true,
      severity: covOk ? "ok" : "block",
      title: covOk
        ? "Every sheet reviewed by every required discipline"
        : `Sheet coverage incomplete — ${Math.round(pct)}%`,
      detail: covOk
        ? "All expected sheets were examined by each discipline assigned to this review."
        : `Some sheets were skipped by one or more disciplines. Re-run the AI check or attach the missing sheets before sending.`,
    });
  }

  // 11. Coastal overlay (Audit M-04 follow-up). DNA flagged the project as
  // coastal but the county's static registry doesn't cover WBDR + flood —
  // boilerplate WBDR/flood callouts will be missing. Block until the
  // reviewer reclassifies the county or escalates manually.
  if (input.dnaIsCoastal === true && input.countyAlreadyCoastal === false) {
    checks.push({
      id: "coastal_overlay",
      required: true,
      severity: "block",
      title: "Project is coastal but county is classified inland",
      detail:
        "DNA marked this project as coastal (barrier island, WBDR strip, or coastline frontage), but the county registry doesn't carry Wind-Borne Debris Region + flood-zone boilerplate. Reclassify the county to coastal in the registry, or add WBDR/flood comments by hand before sending.",
    });
  }

  // 12. Stale dispositions (audit follow-up risk #6). Any finding whose
  // `updated_at` advanced after the reviewer marked it confirm/reject/modify
  // means the human's decision no longer reflects the current finding text.
  // Force them to re-decide before the letter goes out.
  const stale = live.filter((f) => {
    if (!f.reviewer_disposition || !f.reviewer_disposition_at || !f.updated_at) return false;
    return new Date(f.updated_at).getTime() - new Date(f.reviewer_disposition_at).getTime() > 1000;
  });
  if (stale.length > 0) {
    checks.push({
      id: "stale_disposition",
      required: true,
      severity: "block",
      title: `${stale.length} finding${stale.length === 1 ? " was" : "s were"} edited after triage`,
      detail:
        "These findings changed (text, citation, sheet, etc.) after the reviewer last marked them confirm/reject/modify. Re-triage so the recorded human decision matches the current finding before sending.",
      jumpFindingId: stale[0]?.id,
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
