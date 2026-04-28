/**
 * Single source of truth for pipeline stage names + ordering on the client.
 *
 * MUST stay in sync with the Stage union in
 * `supabase/functions/run-review-pipeline/index.ts`. If you add or rename a
 * stage there, mirror it here and run a search for the affected hooks
 * (`useReviewDashboard`, `PipelineActivity`, `useAllActivePipelines`).
 */
export type PipelineStage =
  | "upload"
  | "prepare_pages"
  | "sheet_map"
  | "submittal_check"
  | "dna_extract"
  | "discipline_review"
  | "critic"
  | "cross_check"
  | "verify"
  | "ground_citations"
  | "challenger"
  | "dedupe"
  | "deferred_scope"
  | "prioritize"
  | "complete";

export const CORE_STAGES: PipelineStage[] = [
  "upload",
  "prepare_pages",
  "sheet_map",
  "submittal_check",
  "dna_extract",
  "discipline_review",
  "critic",
  "dedupe",
  "ground_citations",
  "challenger",
  "complete",
];

export const DEEP_STAGES: PipelineStage[] = [
  "verify",
  "cross_check",
  "deferred_scope",
  "prioritize",
];

export function shortStageLabel(stage: string): string {
  return stage.replace(/_/g, " ");
}
