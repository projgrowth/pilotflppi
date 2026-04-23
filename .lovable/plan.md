

## Stop edge worker memory crashes by sharding the pipeline into self-invoking stages

### Why it's still crashing

The previous fix moved work into `EdgeRuntime.waitUntil`, but **all 11 stages still execute inside one worker**. The first stage to call `signedSheetUrls()` (sheet_map) downloads every PDF, loads MuPDF WASM, and rasterizes every page (up to 80) before returning. Even at 110 DPI, MuPDF + page buffers + the loaded WASM module + the rest of the pipeline state pushes past the worker memory ceiling. The `RASTERIZE_CHUNK = 12` constant exists but is unused — the streaming function still loops the whole document in one call.

Background tasks share the same memory limit as the request worker. So `waitUntil` doesn't help here.

### The fix: one HTTP invocation = one stage

Refactor the pipeline so each stage runs in its own fresh edge worker. When a stage finishes, it self-invokes the function for the next stage and returns. Memory resets between stages. MuPDF WASM only lives during the rasterization stage.

```text
Client → POST run-review-pipeline {stage:"upload"}     → 202, schedules sheet_map
        POST run-review-pipeline {stage:"sheet_map"}   → 202, schedules dna_extract
        POST run-review-pipeline {stage:"dna_extract"} → 202, schedules discipline_review
        ...
```

Each call:
1. Reads the requested stage from the body (default `upload` for the first call).
2. Marks that single stage `running`, runs it, marks `complete`/`error`.
3. If more stages remain and not halted, fires a non-awaited `fetch` to its own URL with `{plan_review_id, stage: next}` and returns 202 immediately.
4. The next worker boots clean — MuPDF, page buffers, AI response bodies from the previous stage are all gone.

Realtime UX is unchanged because the stepper subscribes to `review_pipeline_status`, not to the HTTP response.

### Make rasterization actually chunked

`signedSheetUrls()` currently rasterizes every page of every PDF in one call. Split into a real prepare-pages loop:

- New helper `rasterizeNextChunk(planReviewId, firmId)` reads the manifest, finds the first source PDF that still has missing pages, downloads only that PDF, rasterizes the next `RASTERIZE_CHUNK` (12) pages, uploads them, writes manifest rows, then returns `{ done: false }` if more pages remain.
- New stage `prepare_pages` inserted after `upload`. It calls `rasterizeNextChunk` once, and if not done, schedules another `prepare_pages` invocation instead of advancing to `sheet_map`.
- Result: each worker handles at most 12 pages of one PDF, then dies. MuPDF WASM never accumulates more than one chunk's worth of state.

Downstream stages (sheet_map, discipline_review, verify, cross_check) read the manifest rows + sign URLs only — no rasterization in their workers.

### Stage list update

```text
upload → prepare_pages (loops itself until manifest is full)
       → sheet_map → dna_extract → discipline_review
       → verify → dedupe → ground_citations → cross_check
       → deferred_scope → prioritize → complete
```

`PipelineProgressStepper` and `useReviewDashboard` need the new `prepare_pages` stage in their stage list.

### Self-invoke pattern (avoids a separate dispatcher function)

```ts
async function scheduleNextStage(planReviewId: string, nextStage: Stage) {
  // Fire-and-forget POST to ourselves. Don't await the response.
  fetch(`${SUPABASE_URL}/functions/v1/run-review-pipeline`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ plan_review_id: planReviewId, stage: nextStage }),
  }).catch((e) => console.error("schedule next stage failed:", e));
}
```

Wrapped in `EdgeRuntime.waitUntil` so the request can return 202 first without aborting the outbound fetch.

### Files touched

- `supabase/functions/run-review-pipeline/index.ts`
  - Accept optional `stage` in request body (default `"upload"`).
  - Run only that single stage per invocation.
  - After the stage completes, schedule the next stage via self-fetch.
  - Add `prepare_pages` to the `Stage` union and `STAGES` list.
  - Add `stagePreparePages` that calls a new chunked rasterizer and self-loops while pages remain.
  - Refactor `signedSheetUrls` to ONLY read the manifest / sign URLs (no rasterization fallback). The cold path is now exclusively in `stagePreparePages`.
  - Use the existing `RASTERIZE_CHUNK = 12` constant.

- `src/components/plan-review/PipelineProgressStepper.tsx`
  - Add `prepare_pages` to the displayed stage labels.

- `src/hooks/useReviewDashboard.ts`
  - Add `prepare_pages` to the stage list / type.

### Expected result

- `WORKER_RESOURCE_LIMIT` stops happening because no worker ever holds MuPDF + a full plan set simultaneously.
- Each invocation runs ≤ ~5–15 seconds with a small memory footprint.
- Realtime stepper UX is unchanged from the user's view — they still see stages tick over live.

