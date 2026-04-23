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
    .lt("updated_at", cutoff)
    .select("id");

  // RLS already scopes to firm, but adding the filter shaves planner work.
  const { data, error } = firmId
    ? await query.eq("firm_id", firmId)
    : await query;
  if (error) throw error;
  return data?.length ?? 0;
}

/**
 * Manually re-kick a stuck pipeline stage. The worker likely died (CPU limit,
 * network blip) and never scheduled the next chunk. Posting a fresh edge
 * function invocation lets it resume from the persisted manifest / DB state.
 *
 * Steps:
 *   1. Clear `cancelled_at` so the new worker doesn't immediately halt.
 *   2. Reset the stuck stage row to `pending` (clears error / started_at).
 *   3. Invoke `run-review-pipeline` with the same stage + mode.
 */
export async function resumePipelineForReview(
  planReviewId: string,
  stage: string,
): Promise<void> {
  const { data: prev } = await supabase
    .from("plan_reviews")
    .select("ai_run_progress")
    .eq("id", planReviewId)
    .maybeSingle();
  const progress =
    (prev?.ai_run_progress as Record<string, unknown> | null) ?? {};
  if ("cancelled_at" in progress) {
    const { cancelled_at: _omit, ...rest } = progress as {
      cancelled_at?: unknown;
      [k: string]: unknown;
    };
    void _omit;
    await supabase
      .from("plan_reviews")
      .update({ ai_run_progress: rest as Record<string, never> })
      .eq("id", planReviewId);
  }

  // Reset EVERY stuck row, not just the one the user clicked. Otherwise the
  // dispatcher's per-review watchdog redirects to an earlier still-running
  // stage and keeps looping.
  await supabase
    .from("review_pipeline_status")
    .update({
      status: "pending",
      error_message: null,
      started_at: null,
      completed_at: null,
    })
    .eq("plan_review_id", planReviewId)
    .in("status", ["running", "pending", "error"]);

  const mode =
    (progress as { mode?: string }).mode === "deep" ? "deep" : "core";
  const { error } = await supabase.functions.invoke("run-review-pipeline", {
    body: { plan_review_id: planReviewId, stage, mode },
  });
  if (error) throw error;
}
