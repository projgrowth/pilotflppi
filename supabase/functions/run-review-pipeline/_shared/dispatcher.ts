// Self-invocation dispatcher: posts back to this same edge function with a
// single `stage` to run, so each stage gets a fresh worker (= fresh memory
// budget). MuPDF WASM, page buffers, and AI response state from the previous
// stage never co-exist in one worker.

import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "./env.ts";
import type { Stage, PipelineMode } from "./types.ts";

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
      if (!r.ok) console.error(`[schedule] ${nextStage} → HTTP ${r.status}`);
    })
    .catch((e) => console.error(`[schedule] ${nextStage} fetch failed:`, e));
}
