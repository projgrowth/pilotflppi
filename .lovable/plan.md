

## Other things that can prevent plan-review upload + analysis from working

You've focused on the `prepare_pages` CPU crash. The DB confirms it's still failing: latest run at 13:10:47 marked `prepare_pages: running`, `CPU Time exceeded` 4 minutes later, and `plan_review_page_assets` has **zero rows for that review**. The JPEG/chunk-8 fix isn't enough on its own. Here are the remaining issues that can independently break upload + review.

### 1. MuPDF WASM cold-load itself is the real CPU killer (highest priority)

`import * as mupdf from "npm:mupdf@1.3.0"` lazily instantiates a ~10 MB WASM module the first time `Document.openDocument` is called. That instantiation alone burns ~1.5–2 s of CPU per cold worker, before any page is rendered. With each `prepare_pages` chunk getting a fresh worker, **every chunk pays the WASM cold-start tax**, and the worker dies before producing a single manifest row.

Fix options (any one will work; first is easiest):
- **Drop `RASTERIZE_CHUNK` to 4** so the first chunk fits inside the budget even with the WASM cold-start.
- **Move the `mupdf` import to dynamic `await import("npm:mupdf@1.3.0")` inside `rasterizeNextChunk`** and add a top-of-function `EdgeRuntime.userWorkerEvents`-style budget guard so we abort cleanly with a "needs another chunk" return instead of a hard kill.
- **Skip MuPDF entirely on the first chunk**: read just `pdfBlob.arrayBuffer().byteLength` to confirm the file is reachable, write one placeholder manifest row marking the source as "in-progress", and self-invoke for the second chunk where MuPDF actually loads.

### 2. The launch flow is not idempotent — a 5-min worker death leaves the review unrecoverable from the UI

`NewPlanReviewWizard.handleLaunch` invokes the pipeline once via `supabase.functions.invoke(...)` and then closes. There is no way for the UI to:
- detect that a stage has been `running` for >2 minutes and is actually dead,
- or restart `prepare_pages` from where it left off,
- or surface the failure to the user beyond the realtime stepper showing a stuck spinner.

Symptom from the user's perspective: "preparing pages forever, no error, no retry button."

Fix:
- In `PipelineProgressStepper`, if any stage has `status='running'` with `started_at` older than 90 s, show a **Retry stage** button.
- Wire it to call `run-review-pipeline` with `{ plan_review_id, stage: 'prepare_pages' }` to nudge a fresh worker.

### 3. Client-side AI extraction during upload can hang the wizard before files are even uploaded

`extractProjectInfo` (Step 1 → Step 2) calls `renderTitleBlock` (PDF.js in the browser) and then `callAI({ action: 'extract_project_info' })` against the `ai` edge function. If `ai` is down, slow, or returns malformed JSON, the user is stuck on Step 1 with an indefinite spinner — they think "upload is broken" when in fact it's the AI extraction.

Fix:
- Add a 20 s timeout around `callAI` and on timeout fall through to `setStep(2)` with empty fields and a toast: "AI extraction unavailable, please fill in manually."
- The **Skip extraction** button already exists but isn't visible enough; promote it.

### 4. No file-count / total-size guardrail

`handleFileUpload` enforces 50 MB per file but allows unlimited files. Two 50 MB PDFs at 80 pages each = 160 pages × ~110 DPI JPEGs = ~50 chunks × WASM cold-start ≈ guaranteed multi-hour run even after the CPU fix.

Fix:
- Cap **total upload size at 80 MB** and **total page count at 120** across all files, validated client-side in `handleFileUpload` before adding to `uploadedFiles`. Show a clear error if exceeded.

### 5. The dispatcher's parallel-fork branch can double-bill CPU

In the `prepare_pages` branch of `runOneStage` (lines ~3241–3266), if a review has 2+ PDFs and the current worker has no `targetSource`, it fires **two** `scheduleNextStage` calls in parallel. With WASM cold-start being the dominant cost, both forked workers pay it independently and are more likely to both crash than to finish. Currently the user has only 1 PDF so this isn't biting yet, but it will.

Fix:
- Disable the parallel fork until single-PDF prepare is reliable. Always schedule exactly one next worker.

### 6. The wizard's "fire-and-forget" pipeline call hides startup errors

`invokePipeline` is called with `.catch()` only after `setStep(3)`. If the function returns a 401/500 (e.g. JWT issue, missing service role), the user sees the stepper sitting at "Pending" forever with no toast.

Fix:
- `await` the invoke, surface non-202 responses as `pipelineError`, and only advance to Step 3 once the function returns 202.

### 7. Edge function CORS allow-list omits two headers Supabase JS now sends

The current `Access-Control-Allow-Headers` on `run-review-pipeline` lists `x-supabase-client-platform` etc. but does not include `x-supabase-api-version`, which newer `@supabase/supabase-js` releases add. Browsers will silently drop the preflight and the user sees a generic "Edge Function returned a non-2xx status code." Add it.

---

### Recommended order of attack

1. **#1** — drop `RASTERIZE_CHUNK` to 4 and confirm the first chunk completes (one-line change, immediate signal).
2. **#2** — add the 90-second "stuck stage" detector + Retry button so the user is never stranded again.
3. **#4** — add total-size and total-page guardrails to upload.
4. **#3** — add timeout/skip on AI extraction so upload can't be blocked by `ai`.
5. **#6, #7** — small reliability cleanups.
6. **#5** — disable the multi-PDF parallel fork until #1 is proven stable.

### Files that would change

- `supabase/functions/run-review-pipeline/index.ts` — `RASTERIZE_CHUNK`, dispatcher fork branch, CORS allow-list.
- `src/components/NewPlanReviewWizard.tsx` — upload size/page caps, AI extraction timeout, awaited invoke.
- `src/components/plan-review/PipelineProgressStepper.tsx` — stuck-stage detector + Retry button calling `run-review-pipeline` with explicit `stage`.

