/**
 * review-next-step — single source of truth for "what should the reviewer
 * do next on this review?".
 *
 * Replaces the scatter of competing banners (PreparePages bar + StuckRecovery
 * "Prepare now" + SubmittalIncomplete + completion flash on the Analyze button)
 * with one prioritized ladder. Highest-severity unmet condition wins; the UI
 * renders exactly that one CTA via `ReviewNextStepRail`.
 *
 * Pure / synchronous: callers pass everything in. No queries here so the
 * function is trivially testable and stays out of React render cycles.
 */
import type { Finding } from "@/components/FindingCard";

export type NextStepKind =
  | "upload_failed"
  | "needs_preparation"
  | "partial_rasterize"
  | "pipeline_error"
  | "submittal_incomplete"
  | "dna_unconfirmed"
  | "needs_human_review"
  | "findings_ready_no_letter"
  | "letter_ready_to_send"
  | "sent_awaiting_resub"
  | "complete"
  | "idle";

export type NextStepTone = "danger" | "warning" | "primary" | "success" | "muted";

export interface NextStep {
  kind: NextStepKind;
  tone: NextStepTone;
  /** ≤40 char primary line shown in the rail. */
  headline: string;
  /** ≤120 char explainer. Optional. */
  detail?: string;
  /** Primary CTA label. Empty → no button (informational only). */
  ctaLabel?: string;
  /** Secondary, less-prominent action (e.g. "Open dashboard"). */
  secondaryLabel?: string;
}

export interface NextStepInputs {
  hasDocuments: boolean;
  pipelineProcessing: boolean;
  pageAssetCount: number;
  expectedPages: number | null;
  preparePagesErrored: boolean;
  hasFatalPipelineError: boolean;
  /** ai_run_progress JSON (loose). */
  aiRunProgress: Record<string, unknown> | null;
  aiCheckStatus: string | null | undefined;
  qcStatus: string | null | undefined;
  hasCommentLetterDraft: boolean;
  letterSentAt: string | null | undefined;
  findings: Finding[];
}

const num = (x: unknown): number | null =>
  typeof x === "number" && Number.isFinite(x) ? x : null;
const str = (x: unknown): string | null => (typeof x === "string" && x ? x : null);
const bool = (x: unknown): boolean => x === true;

/**
 * Walk the ladder top-down and return the first matching step. Order matters:
 * a hard blocker (upload didn't land) must outrank a soft hint (DNA unconfirmed).
 */
export function selectNextStep(input: NextStepInputs): NextStep {
  const p = input.aiRunProgress ?? {};

  // 1. Upload never landed — pipeline can't even attempt.
  if (!input.hasDocuments) {
    return {
      kind: "upload_failed",
      tone: "danger",
      headline: "Upload your plan PDFs",
      detail: "No files attached yet. Drop a cover sheet, code summary, and discipline drawings to start the review.",
      ctaLabel: "Choose files",
    };
  }

  // 2. Edge rasterizer punted — only browser pdf.js can recover.
  if (input.preparePagesErrored) {
    return {
      kind: "needs_preparation",
      tone: "warning",
      headline: "Prepare pages in your browser",
      detail: "The server couldn't rasterize one or more PDFs. Your browser can render them locally — takes ~10s per page.",
      ctaLabel: "Prepare pages now",
    };
  }

  // 3. Files exist but no page assets — pipeline would 404 on every page.
  if (input.hasDocuments && input.pageAssetCount === 0 && !input.pipelineProcessing) {
    return {
      kind: "needs_preparation",
      tone: "warning",
      headline: "Pages haven't been prepared yet",
      detail: "Click below to render each sheet so the AI can read it.",
      ctaLabel: "Prepare pages now",
    };
  }

  // 4. Partial manifest from upload — explicit limbo state.
  const expected = input.expectedPages ?? num(p.expected_pages);
  if (
    expected !== null &&
    expected > 0 &&
    input.pageAssetCount > 0 &&
    input.pageAssetCount < expected * 0.95 &&
    !input.pipelineProcessing
  ) {
    const missing = Math.max(0, expected - input.pageAssetCount);
    return {
      kind: "partial_rasterize",
      tone: "warning",
      headline: `Finish preparing ${missing} page${missing === 1 ? "" : "s"}`,
      detail: `${input.pageAssetCount} of ${expected} pages are ready. Retry the missing ones before analyzing.`,
      ctaLabel: "Prepare missing pages",
    };
  }

  // 5. Pipeline crashed and isn't actively retrying.
  if (input.hasFatalPipelineError && !input.pipelineProcessing) {
    return {
      kind: "pipeline_error",
      tone: "danger",
      headline: "Analysis stopped with an error",
      detail: str(p.failure_reason) ?? "The pipeline didn't finish. Restart it once you've fixed the underlying issue.",
      ctaLabel: "Restart analysis",
      secondaryLabel: "Open dashboard",
    };
  }

  // 6. Pipeline is actively running — nothing for the user to do.
  if (input.pipelineProcessing) {
    return {
      kind: "idle",
      tone: "muted",
      headline: "Analyzing your plans…",
      detail: "Usually 2–4 minutes. You can close this tab — we'll keep working.",
    };
  }

  // 7. Reviewer must triage — pipeline finished but quality is suspect.
  if (input.aiCheckStatus === "needs_human_review") {
    return {
      kind: "needs_human_review",
      tone: "danger",
      headline: "Manual review required",
      detail: str((p as { blocker_reason?: unknown }).blocker_reason) ??
        "Results look thin or unverified. Triage findings before sending the letter.",
      ctaLabel: "Open triage dashboard",
    };
  }

  // 8. Submittal incomplete — non-blocking warning, but reviewer must
  //    confirm intent before sending.
  if (bool(p.submittal_incomplete)) {
    const missingRaw = (p as { submittal_missing_disciplines?: unknown }).submittal_missing_disciplines;
    const missing = Array.isArray(missingRaw)
      ? missingRaw.filter((d): d is string => typeof d === "string")
      : [];
    return {
      kind: "submittal_incomplete",
      tone: "warning",
      headline: missing.length
        ? `Confirm missing: ${missing.slice(0, 3).join(", ")}`
        : "Confirm submittal is complete",
      detail: "Required disciplines weren't detected. Confirm they're on a separate permit before sending the letter.",
      ctaLabel: "Review SUB001 finding",
    };
  }

  // 9. DNA card hasn't been confirmed — recommended human sanity check.
  if (input.findings.length > 0 && !str(p.dna_confirmed_at)) {
    return {
      kind: "dna_unconfirmed",
      tone: "primary",
      headline: "Confirm project DNA (30s)",
      detail: "Quick sanity check on FBC edition, occupancy, and use type before you generate the letter.",
      ctaLabel: "Confirm DNA",
    };
  }

  // 10. Letter dispatched — waiting on the contractor.
  if (input.letterSentAt) {
    return {
      kind: "sent_awaiting_resub",
      tone: "success",
      headline: "Letter sent — awaiting resubmittal",
      detail: "Statutory clock is paused. Open a new round when the contractor uploads revised plans.",
      ctaLabel: "Open new round",
    };
  }

  // 11. Letter drafted — needs reviewer to send.
  if (input.hasCommentLetterDraft && input.qcStatus === "qc_approved") {
    return {
      kind: "letter_ready_to_send",
      tone: "primary",
      headline: "Send comment letter",
      detail: "QC approved. Review the readiness gate, then dispatch.",
      ctaLabel: "Review & send letter",
    };
  }

  // 12. Findings ready, no letter yet — most common "what's next".
  if (input.findings.length > 0 && !input.hasCommentLetterDraft) {
    return {
      kind: "findings_ready_no_letter",
      tone: "primary",
      headline: `${input.findings.length} finding${input.findings.length === 1 ? "" : "s"} ready — generate letter`,
      detail: "Triage the findings, then draft the comment letter.",
      ctaLabel: "Generate comment letter",
    };
  }

  // 13. Pipeline finished cleanly with zero findings.
  if (input.aiCheckStatus === "complete" && input.findings.length === 0) {
    return {
      kind: "complete",
      tone: "success",
      headline: "Review complete — no findings",
      detail: "Plans passed automated review. Generate an approval letter or open a new round.",
      ctaLabel: "Generate approval letter",
    };
  }

  // 14. Default — review exists but nothing's run yet.
  return {
    kind: "idle",
    tone: "muted",
    headline: "Ready to analyze",
    detail: "Click Analyze in the top bar to run the AI plan review.",
  };
}
