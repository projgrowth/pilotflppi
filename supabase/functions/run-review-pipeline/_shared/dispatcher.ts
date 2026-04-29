// Self-invocation dispatcher: posts back to this same edge function with a
// single `stage` to run, so each stage gets a fresh worker (= fresh memory
// budget). MuPDF WASM, page buffers, and AI response state from the previous
// stage never co-exist in one worker.
//
// On dispatch failure we used to only console.error, which left the chain
// silently dead until the 15-min watchdog noticed. We now write a structured
// row to pipeline_error_log so the dashboard surfaces it immediately.

import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "./env.ts";
import { createClient } from "./supabase.ts";
import type { Stage, PipelineMode } from "./types.ts";

async function logDispatchFailure(
  planReviewId: string,
  nextStage: Stage,
  reason: string,
) {
  try {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    await admin.from("pipeline_error_log").insert({
      plan_review_id: planReviewId,
      stage: nextStage,
      error_class: "dispatch_failed",
      error_message: reason.slice(0, 4000),
      severity: "warn",
      attempt_count: 1,
      metadata: { next_stage: nextStage },
    });
    // Surface as a stage-level error so the user sees "stuck" within seconds,
    // not after the 15-min watchdog tick.
    await admin
      .from("review_pipeline_status")
      .upsert(
        {
          plan_review_id: planReviewId,
          stage: nextStage,
          status: "error",
          error_message: `Could not start ${nextStage}: ${reason}`,
          metadata: { error_class: "dispatch_failed" },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "plan_review_id,stage" },
      );
  } catch (err) {
    console.error(`[schedule] failed to log dispatch failure:`, err);
  }
}

export function scheduleNextStage(
  planReviewId: string,
  nextStage: Stage,
  extra?: { mode?: PipelineMode },
) {
  const url = `${SUPABASE_URL}/functions/v1/run-review-pipeline`;
  // Don't await — return immediately and let waitUntil keep this socket alive
  // long enough for the request to flush.
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "x-internal-self-invoke": "1",
    },
    body: JSON.stringify({
      plan_review_id: planReviewId,
      stage: nextStage,
      mode: extra?.mode ?? "core",
      _internal: true,
    }),
  })
    .then((r) => {
      if (!r.ok) {
        const reason = `HTTP ${r.status}`;
        console.error(`[schedule] ${nextStage} → ${reason}`);
        void logDispatchFailure(planReviewId, nextStage, reason);
      }
    })
    .catch((e) => {
      const reason = e instanceof Error ? e.message : String(e);
      console.error(`[schedule] ${nextStage} fetch failed:`, e);
      void logDispatchFailure(planReviewId, nextStage, reason);
    });
}
