

## Why prepare_pages is slow (and how to fix it)

### What's actually happening

The current `rasterizeNextChunk` design optimizes for memory safety, but it pays a steep latency tax on every chunk:

1. **Full PDF re-download per chunk.** Each `prepare_pages` invocation calls `admin.storage.from("documents").download(filePath)` and pulls the *entire* PDF — even though the worker will only rasterize 12 pages from it. A 100MB plan set gets downloaded 7+ times across chunks.
2. **MuPDF document opened twice per chunk.** Once just to call `countPages()`, then destroyed, then re-opened to actually rasterize. The second open re-parses the whole PDF.
3. **Serial uploads.** Each rendered page PNG is uploaded with `await` before the next page is rendered. Storage upload latency (~150-400ms each) stacks linearly: 12 pages × ~250ms ≈ 3s of pure upload wait per chunk.
4. **Serial DB upserts.** A separate `plan_review_page_assets` upsert is awaited per page. Another 12 round-trips.
5. **Cold-boot per chunk.** Every chunk is a brand-new edge worker invocation. Boot logs show ~40-60ms just to boot, plus auth check, plus DB lookups for `plan_reviews` and `plan_review_files` and the existing manifest — repeated for every 12 pages.
6. **Tiny chunk size.** `RASTERIZE_CHUNK = 12` was set conservatively against the old "rasterize-everything-in-one-worker" memory crash. Now that each stage runs in its own fresh worker, 12 is leaving capacity unused and multiplying the per-chunk fixed cost.
7. **Edge log evidence:** The most recent run shows `CPU Time exceeded` on `prepare_pages` (timestamp 1776949426904) — a chunk ran long enough to hit the CPU budget, which is consistent with serial uploads dominating wall-clock time.

### The fix

Make each `prepare_pages` invocation do meaningfully more work, in parallel, without re-downloading or re-parsing.

#### 1. Download the PDF once per chunk, parse once
- Remove the throwaway `doc.openDocument` → `countPages` → `destroy` cycle. Open the PDF a single time, read `countPages()`, then rasterize from the same `doc` handle.
- Net savings: ~1 PDF parse pass per chunk (multi-second on large sets).

#### 2. Increase chunk size and parallelize uploads
- Bump `RASTERIZE_CHUNK` from 12 to **24**. Each fresh worker has plenty of headroom now that stages are sharded.
- Render pages serially (MuPDF WASM is single-threaded), but **collect PNGs in memory** and run uploads + manifest upserts in **parallel batches of 6** using `Promise.all`. Storage and Postgres absorb the concurrency easily; this collapses ~6s of serial waits into ~1s.

#### 3. Bulk-upsert the manifest rows
- Replace 24 individual `plan_review_page_assets` upserts with a single bulk upsert at the end of the chunk. One round-trip instead of N.

#### 4. Stay on the same PDF until it's fully done before scheduling the next worker
- Already the behavior, but make the dispatcher loop tighter: when `needs_more_chunks` is true and we just finished a chunk on PDF #1, the next invocation already has the warm storage cache for that file path — keep ordering by `uploaded_at` so we never thrash between PDFs.

#### 5. Parallelize across PDFs when possible
- If a review has multiple PDFs, fire **two** `prepare_pages` workers in parallel — one targeting the next un-rasterized PDF index 0, one targeting index 1. Add an optional `target_source` param to `rasterizeNextChunk` so each worker is pinned to one source file and they don't fight over the same chunk. The dispatcher only forks when there are 2+ source PDFs with remaining work.

#### 6. Skip the legacy fallback path on hot rasterization
- `signedSheetUrls`'s legacy `pages/` folder listing is irrelevant during `prepare_pages` and just adds storage `list()` calls. Already gated, but confirm nothing in the prepare path triggers it.

### Files touched

- `supabase/functions/run-review-pipeline/index.ts`
  - `rasterizeNextChunk`: open MuPDF once, parallelize uploads (Promise.all batched), bulk-upsert manifest rows, accept optional `targetSource` parameter.
  - `RASTERIZE_CHUNK`: 12 → 24.
  - `stagePreparePages`: when multiple PDFs have remaining work, schedule a second `prepare_pages` invocation in parallel pinned to the next source file.

### Expected result

- **~3–5× faster** `prepare_pages` per chunk (one parse, parallel uploads, bulk DB writes).
- **2× faster** for multi-PDF reviews (parallel workers per source).
- **Fewer total invocations** (24 pages/chunk instead of 12), so less cold-boot and auth overhead.
- No change to memory profile — still one PDF + ≤24 PNGs per worker, well under the limit.
- No change to UI — the `prepare_pages` stepper still ticks live via realtime.

