

# Overhaul `prepare_pages` — eliminate the server rasterizer

## What the data tells us

```text
Last 10 reviews:
  pre_rasterized=true        → 1   (asset_count = 6, prepare_pages OK)
  pre_rasterized=null/false  → 9   (asset_count = 0 or 1, prepare_pages errored)

Last-7d prepare_pages stage rows:
  status=error: 5    status=complete: 0
  → 100% failure rate when the server has to rasterize anything
```

**Root cause:** Whenever `prepare_pages` actually has to run server-side, it dies on the first chunk. The CPU budget on a fresh Supabase Edge worker is ~2s. MuPDF WASM cold-load alone is ~1.5–2s, then it has to download a 50MB PDF, decode page 0, JPEG-encode at 60–110 DPI, upload the JPEG, write the manifest row. Even with `RASTERIZE_CHUNK_COLD_START = 1` and `RASTER_SCALE_COLD = 0.833`, the first chunk usually doesn't finish before the runtime kills it.

The 8-attempt bounded retry just retries the same losing race 8 times, then marks the stage `error`. Reviews stuck after just 1 page in the manifest are the proof — chunk 0 sometimes squeaks through, chunk 1 never does on a cold worker.

**Why the 1 working review worked:** It came through the wizard, where `uploadPlanReviewFiles()` ran browser-side rasterization with pdf.js BEFORE invoking the pipeline. Server `prepare_pages` was a 50 ms no-op that just verified the manifest count matched. Every other recent upload skipped the browser rasterization (either inline-uploaded before today's helper landed, or the browser path failed silently and fell through to the server).

The architecture is already correct in concept; the server fallback is the part that doesn't actually work. We should **stop pretending the edge function can rasterize PDFs** and make the browser path the only path.

---

## The overhaul

### 1. Server `prepare_pages` becomes verify-only — never rasterizes

Replace the chunked MuPDF rasterizer with a thin verifier:

```text
stagePreparePages(reviewId):
  manifest = SELECT * FROM plan_review_page_assets WHERE plan_review_id=…
  if manifest.length >= 1 and signed-URL spot-check on manifest[0] succeeds:
      return { ok: true, prepared_pages: manifest.length }
  else:
      throw NEEDS_BROWSER_RASTERIZATION  // structured error class
```

That's the entire stage. ~30 lines instead of ~250. No MuPDF import, no chunk loop, no DPI tiers, no `prepare_attempts` counter, no per-PDF watchdog, no `target_source` parameter, no `remaining_sources` fork logic. All of that machinery exists only to fight the CPU limit — once we remove the rasterizer from the edge function, it becomes dead code.

### 2. Structured failure tells the client to take over

When the server throws `NEEDS_BROWSER_RASTERIZATION`:
- Write a `pipeline_error_log` row with `error_class = 'needs_browser_rasterization'`.
- Mark the stage `error` with a clear `error_message` ("This review needs to be re-uploaded so pages can be prepared in your browser.").
- The dashboard already subscribes to errors — surface a toast with a **"Re-prepare in browser"** CTA that hands the existing files back through `uploadPlanReviewFiles()` (skipping the upload step since the PDFs are already in storage; just signs URLs, downloads them, runs `rasterizeAndUploadPages`, then re-invokes the pipeline at `prepare_pages`).

### 3. Recover the 9 stuck reviews

A new `src/lib/reprepare-in-browser.ts` helper does what the inline upload should have done: for a given review, list the source PDFs in `plan_review_files`, signed-URL each, fetch+blob them, run `rasterizeAndUploadPages`, mark `ai_run_progress.pre_rasterized = true`, then `startPipeline(reviewId, 'core')`. Wired into:
- The Pipeline Activity error toast/CTA.
- A small "Re-prepare pages" button on `PlanReviewDetail` next to the stuck file.

This unblocks every existing review without DB surgery.

### 4. Make sure inline uploads always pre-rasterize

`uploadPlanReviewFiles()` already does this when `typeof window !== "undefined"` and `pdf.js` succeeds, but if `getPDFPageCount(file)` throws (corrupt magic bytes, password-protected PDF, etc.) the file is silently dropped from the rasterization pairs and the server fallback used to swallow it. With server rasterization gone, this becomes a hard error the user can see. Two changes:
- Validate via `validatePDFHeader()` BEFORE accepting the file, so non-PDFs and corrupt PDFs are rejected with a clear toast at upload time.
- If `rasterizeAndUploadPages()` returns 0 rows for a valid PDF, surface that as a hard error rather than continuing silently.

### 5. Bonus simplifications enabled by removing server raster

- Delete `getMupdf()`, `rasterizePdfStreaming()`, `rasterizeNextChunk()`, `computeRemainingSources()`, the `RASTERIZE_*` / `RASTER_SCALE_*` / `LARGE_PDF_THRESHOLD` / `MAX_PAGES_PER_PDF` / `RASTER_UPLOAD_CONCURRENCY` constants, the `_pageManifestCache` (no longer needed since prepare is now O(1)), the `PREPARE_STALE_RUNNING_MS` watchdog block (~50 lines in the dispatcher), the `prepare_attempts` retry branch, and the `target_source` plumbing through `scheduleNextStage`.
- `npm:mupdf@1.3.0` import goes away → faster cold starts for every other stage too.
- Edge function drops from ~3,575 → ~2,950 lines.

---

## Files changed

```text
supabase/functions/run-review-pipeline/index.ts
  • Replace stagePreparePages with verify-only version (~30 lines)
  • Delete rasterizer + helpers (~700 lines net removal)
  • Delete prepare_pages watchdog block in dispatcher
  • Replace prepare_pages catch branch with single error log + clear message
  • Drop mupdf import

src/lib/reprepare-in-browser.ts                              [NEW]
  • Re-runs browser rasterization for an already-uploaded review

src/lib/plan-review-upload.ts
  • validatePDFHeader gate before accepting files
  • Hard error if a valid PDF yields 0 page assets

src/components/review-dashboard/ReviewStatusBar.tsx
  (or wherever the error toast is wired)
  • Add "Re-prepare in browser" action when error_class = needs_browser_rasterization

src/pages/PlanReviewDetail.tsx
  • Add Re-prepare button next to file when prepare_pages errored

src/hooks/usePipelineErrors.ts
  • No change — already streams errors; the new error_class flows through
```

No DB schema changes. No edge function contract changes. The dispatcher still accepts `{ plan_review_id, stage?, mode? }`, just no longer accepts `target_source`