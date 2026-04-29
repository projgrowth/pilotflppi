import { supabase } from "@/integrations/supabase/client";

/**
 * Kick off the review pipeline for a plan_review.
 *
 * Centralizes three things that callers used to do inline:
 *   1. Clears any prior `cancelled_at` flag in `ai_run_progress` so the new
 *      worker doesn't immediately halt.
 *   2. Invokes `run-review-pipeline` with the right body shape.
 *   3. Returns a structured result the caller can hand to `toast`.
 *
 * Errors are returned, not thrown — the caller decides how loud to be.
 */
export async function startPipeline(
  planReviewId: string,
  mode: "core" | "deep" = "core",
  stage?: string,
): Promise<{ ok: boolean; message?: string }> {
  try {
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

    const body: Record<string, unknown> = { plan_review_id: planReviewId, mode };
    if (stage) body.stage = stage;
    const { error } = await supabase.functions.invoke("run-review-pipeline", {
      body,
    });
    if (error) {
      // Concurrency guard (H-04): the edge function returns 409 with
      // { error: "pipeline_already_running", message } when another live
      // run is in flight on this plan_review. Surface a precise message
      // instead of the generic "Edge Function returned a non-2xx status".
      const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context;
      if (ctx?.json) {
        try {
          const payload = (await ctx.json()) as {
            error?: string;
            message?: string;
          };
          if (payload?.error === "pipeline_already_running") {
            return {
              ok: false,
              message: payload.message ?? "Pipeline already running for this review.",
            };
          }
        } catch {
          // fall through to generic error
        }
      }
      return { ok: false, message: error.message };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Pipeline invoke failed",
    };
  }
}
