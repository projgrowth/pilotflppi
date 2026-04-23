
## Why upload + review feel slow and keep failing

### What is actually happening today

There are two separate slow parts, and both are expensive:

1. **Before analysis even starts, the browser does a lot of work**
   - `NewPlanReviewWizard.tsx` validates each PDF, reads page counts for each file, renders the first page title block client-side, runs AI extraction, then geocodes the address.
   - That makes the “upload” step feel slow even before the review pipeline begins.

2. **The review pipeline is doing edge-worker-unfriendly work**
   - `run-review-pipeline/index.ts` eagerly rasterizes every uploaded PDF page into PNGs in the edge function during `upload`.
   - It uses MuPDF WASM in-process, at ~150 DPI, up to **200 pages per PDF**.
   - It then repeatedly calls `signedSheetUrls()` across many stages, which means repeated storage listing/signing and reloading of the same large page set.
   - Several AI stages send lots of images at once:
     - `sheet_map` processes the whole set in batches
     - `discipline_review` can send all general pages plus all discipline pages for up to 8–9 disciplines
     - `verify` and `cross_check` attach more page images again
   - `EdgeRuntime.waitUntil` helps with request timeout, but it does **not** remove the CPU/memory ceiling. The logs already confirm the real failure mode: **Memory limit exceeded**.

### Root causes in this codebase

**Primary failure source**
- `stageUpload()` calls `signedSheetUrls()`, which downloads PDFs and rasterizes all pages inside the edge worker.
- That is the main reason for `WORKER_RESOURCE_LIMIT`.

**Primary slowness sources**
- Client-side pre-processing in the wizard before the review is even created.
- Repeated `signedSheetUrls()` calls in multiple stages instead of one persisted page manifest.
- Over-large multimodal AI payloads, especially in `discipline_review`, `verify`, and `cross_check`.

**Secondary UX issue**
- Some UI still assumes the pipeline finishes synchronously even though the function now returns `202 Accepted`.
- That makes the app feel confusing because users get “started” or “complete” messaging that doesn’t fully match reality.

---

## Plan to make it faster and stop edge-function crashes

### 1. Move PDF rasterization out of the edge function hot path
Replace eager full-set rasterization during `upload` with a lighter architecture:

- Stop rasterizing every page in `stageUpload()`.
- Persist a **page manifest / cached page registry** once pages are available, instead of recomputing via `signedSheetUrls()` in every stage.
- Only rasterize pages when a later stage truly needs them, and only for the subset of pages that stage will inspect.

Implementation direction:
- Add a new table like `plan_review_page_assets` keyed by `plan_review_id + file_path + page_index` with:
  - storage path
  - signed-url source metadata
  - rasterization status
  - width/height if helpful
- Populate this incrementally instead of all-at-once.

### 2. Remove “rasterize everything” from the upload stage
Change `stageUpload()` to become a cheap validation/index stage:

- confirm files exist
- maybe record file counts / source metadata
- do not materialize all pages yet

This will make the first visible pipeline step fast and avoid immediate memory spikes.

### 3. Split page preparation from analysis and keep it incremental
Introduce a dedicated page-prep phase before AI-heavy stages:

```text
upload -> prepare_pages -> sheet_map -> dna_extract -> discipline_review -> verify -> ...
```

For `prepare_pages`:
- process pages in very small chunks
- persist progress in `review_pipeline_status.metadata`
- skip already-prepared pages on retries / reruns
- never hold the whole document set in memory at once

### 4. Stop recomputing signed page URLs in every stage
Refactor all uses of `signedSheetUrls()` so stages consume a cached manifest instead.

Current repeated consumers:
- `stageUpload`
- `stageSheetMap`
- `stageDnaExtract`
- `stageDisciplineReview`
- `stageCrossCheck`
- `stageDeferredScope`
- `stageVerify`

After the refactor:
- one helper reads prepared page rows from the DB
- only signs the exact pages needed for the current stage
- avoids repeated folder listing and repeated whole-review page enumeration

### 5. Shrink AI image payloads aggressively
Reduce how many images each AI call sees:

- **Sheet map**: batch smaller than 8 when needed; cap pages for giant reviews and let the rest process incrementally.
- **DNA extract**: keep to cover/code-summary pages only.
- **Discipline review**:
  - cap discipline pages per run
  - run multiple smaller discipline chunks instead of “all discipline sheets at once”
  - keep only 1–2 general context pages
- **Cross-check**: lower the 12-sheet cap or make it targeted by discipline/sheet type.
- **Verify**: verify in smaller batches and prefer only the explicitly cited pages.

This reduces both AI latency and edge memory pressure.

### 6. Trim client-side upload latency
Make the wizard feel faster by reducing browser-side work before review creation:

- keep PDF magic-byte validation
- stop counting every page up front for every file if it is only used for display
- make title-block extraction optional/background after file registration
- defer geocoding until after project/review creation if needed

Goal: user reaches “Analyze” much faster.

### 7. Make async pipeline UX honest everywhere
Update places that still behave like the pipeline is synchronous:

- `ReviewDashboard.tsx` should no longer inspect `data.stages` from the function response, because the function now returns early with `202`.
- `ProjectDNAViewer.tsx` should not toast “Pipeline re-run complete” immediately after invoke; it should say “re-run started” and let realtime status show completion.
- Keep the wizard/topbar steppers as the source of truth for long-running progress.

### 8. Add guardrails for oversized reviews
For very large submissions:
- cap maximum pages analyzed per run
- mark overflow as “needs staged review” in pipeline metadata
- surface a clear message in the UI rather than letting the worker die

This prevents one huge plan set from crashing the whole review flow.

---

## Files to change

### Backend
- `supabase/functions/run-review-pipeline/index.ts`
  - remove eager full rasterization from `stageUpload`
  - add incremental page-prep stage / cached asset lookup
  - replace repeated `signedSheetUrls()` flow with manifest-based helpers
  - reduce per-stage image payload sizes
- New migration:
  - add `plan_review_page_assets` (or equivalent cache table)
  - enable RLS and indexes for `plan_review_id`, `page_index`, `status`

### Frontend
- `src/components/NewPlanReviewWizard.tsx`
  - reduce blocking pre-analysis work during upload/confirm
- `src/pages/ReviewDashboard.tsx`
  - stop expecting synchronous pipeline results
- `src/components/review-dashboard/ProjectDNAViewer.tsx`
  - change rerun messaging to async “started” flow
- `src/components/plan-review/PipelineProgressStepper.tsx`
  - include the new page-prep stage if added
- `src/hooks/useReviewDashboard.ts`
  - update stage list/types for the new pipeline stage

---

## Expected result after implementation

### Upload feels faster
Because the browser is no longer doing as much PDF work before creating the review.

### Pipeline becomes much more reliable
Because the edge function is no longer rasterizing entire plan sets up front in one worker and no longer re-processing the same pages across multiple stages.

### Fewer edge-function failures
Because memory-heavy work is chunked, cached, and limited per stage instead of all-at-once.

### More predictable review times
Because the runtime cost scales by the pages actually needed for each stage, not by repeatedly touching the full submission.

---

## Technical notes

- The current `waitUntil` pattern is not enough by itself. It solves request/response timing, but not the edge worker’s memory/CPU budget.
- The log evidence points to the real bottleneck:
  - boot succeeds
  - then `Memory limit exceeded`
  - then shutdown
- The main architectural issue is not auth or routing; it is **PDF page preparation + repeated large multimodal payloads inside an edge worker**.
