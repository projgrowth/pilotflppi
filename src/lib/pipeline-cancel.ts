import { supabase } from "@/integrations/supabase/client";

/**
 * Cancel a single plan review's pipeline.
 *
 * Two steps so the UI updates instantly even before the worker wakes up:
 *   1. Write `cancelled_at` into `plan_reviews.ai_run_progress` — the worker
 *      checks this between stages and halts without scheduling the next one.
 *   2. Mark every `running` / `pending` row in `review_pipeline_status` as
 *      `error` with `"Cancelled by user"` so the stepper reflects the stop
 *      immediately.
 */
export async function cancelPipelineForReview(planReviewId: string): Promise<void> {
  const { data: prev } = await supabase
    .from("plan_reviews")
    .select("ai_run_progress")
    .eq("id", planReviewId)
    .maybeSingle();
  const progress =
    (prev?.ai_run_progress as Record<string, unknown> | null) ?? {};

  await supabase
    .from("plan_reviews")
    .update({
      ai_run_progress: {
        ...progress,
        cancelled_at: new Date().toISOString(),
      },
    })
    .eq("id", planReviewId);

  await supabase
    .from("review_pipeline_status")
    .update({
      status: "error",
      error_message: "Cancelled by user",
      completed_at: new Date().toISOString(),
    })
    .eq("plan_review_id", planReviewId)
    .in("status", ["running", "pending"]);
}

/**
 * Mark long-stale `pending` rows (never started_at, older than 10 minutes) as
 * orphaned. These are zombies left behind by failed worker invocations.
 */
export async function clearOrphanedPipelineRows(firmId: string | null): Promise<number> {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const query = supabase
    .from("review_pipeline_status")
    .update({
      status: "error",
      error_message: "Orphaned — never started",
      completed_at: new Date().toISOString(),
    })
    .eq("status", "pending")
    .is("started_at", null)
    .lt("created_at", cutoff)
    .select("id");

  // RLS already scopes to firm, but adding the filter shaves planner work.
  const { data, error } = firmId
    ? await query.eq("firm_id", firmId)
    : await query;
  if (error) throw error;
  return data?.length ?? 0;
}
