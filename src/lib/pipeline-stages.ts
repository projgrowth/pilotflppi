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
  | "dna_extract"
  | "discipline_review"
  | "cross_check"
  | "verify"
  | "ground_citations"
  | "dedupe"
  | "deferred_scope"
  | "prioritize"
  | "complete";

export const CORE_STAGES: PipelineStage[] = [
  "upload",
  "prepare_pages",
  "sheet_map",
  "dna_extract",
  "discipline_review",
  "dedupe",
  "complete",
];

export const DEEP_STAGES: PipelineStage[] = [
  "verify",
  "ground_citations",
  "cross_check",
  "deferred_scope",
  "prioritize",
];

export const PIPELINE_STAGES: { key: PipelineStage; label: string }[] = [
  { key: "upload", label: "Upload" },
  { key: "prepare_pages", label: "Prepare Pages" },
  { key: "sheet_map", label: "Sheet Map" },
  { key: "dna_extract", label: "DNA Extract" },
  { key: "discipline_review", label: "Discipline Review" },
  { key: "cross_check", label: "Cross-Check" },
  { key: "verify", label: "Verify" },
  { key: "ground_citations", label: "Ground Citations" },
  { key: "dedupe", label: "Dedupe" },
  { key: "deferred_scope", label: "Deferred Scope" },
  { key: "prioritize", label: "Prioritize" },
  { key: "complete", label: "Complete" },
];

export function shortStageLabel(stage: string): string {
  return stage.replace(/_/g, " ");
}
