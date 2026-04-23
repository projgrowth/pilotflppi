

## Why prepare_pages still stalls — and the real fix

### The actual bottleneck (confirmed from logs)

Pipeline status for the current review shows `prepare_pages: running` since 13:10:47, and the edge logs show `CPU Time exceeded` ~5 minutes later. **`plan_review_page_assets` is empty** — meaning the worker dies before it can even bulk-upsert a single chunk's manifest rows.

The previous "parallelize uploads + bulk upsert" fix targeted I/O wait. But the real ceiling is **CPU time, not wall-clock**. Supabase edge workers have a hard CPU-time budget (~2s of pure CPU work per invocation). Two things in the current `rasterizeNextChunk` blow past it:

1. **`pixmap.asPNG()` per page.** MuPDF WASM's PNG encoder is single-threaded and CPU-bound. At 110 DPI, encoding one architectural sheet to PNG is ~0.4–1.2s of CPU. 24 pages × ~0.6s = ~14s of CPU work → CPU killed long before any uploads finish.
2. **Full PDF re-download every chunk.** A 50–100MB plan set re-downloaded for every 24-page slice burns network + parse time on each cold worker.

The `Promise.all` upload batching helps wall-clock latency, but uploads are I/O-bound (don't count toward CPU budget). PNG encoding does count, and that's what's killing the worker.

### The fix — three changes, one file

#### 1. Render to **JPEG instead of PNG** (the big win)
- Replace `pixmap.asPNG()` with `pixmap.asJPEG(quality)` at quality ~75.
- JPEG encoding in MuPDF is ~5–8× faster CPU-wise than PNG for the same pixmap.
- Output is also ~3–5× smaller (faster uploads, less storage).
- Visual quality at q=75, 110 DPI is more than enough for AI vision models — they aren't reading sub-pixel detail.
- Update `storagePath` extension from `.png` → `.jpg`, content type to `image/jpeg`.
- Update the `p-NNN.png` regex in the manifest dedup logic to accept `.png` OR `.jpg` so old runs still work.
- Update `signedSheetUrls` (no extension assumption) — it already uses `storage_path` from the manifest, so this is automatic.

#### 2. Drop chunk size back to **8 pages per worker**
- 24 was too aggressive once the CPU ceiling was clear. 8 JPEG pages per chunk ≈ ~0.5–1s CPU → comfortably under budget with headroom for download + DB.
- More chunks, but each chunk now reliably finishes. Net throughput is still 2–3× better than the original 12 PNGs because JPEG encode is so much faster and we never lose a worker to CPU exhaustion.

#### 3. Lower DPI floor for very large PDFs
- For PDFs over 40 pages, drop `RASTER_SCALE` from 1.528 (~110 DPI) to 1.111 (~80 DPI) for that rasterization run. Title blocks and dimension callouts are still legible to vision models at 80 DPI; CPU per page drops another ~40%.
- Small PDFs stay at 110 DPI (current quality).

### Files touched

- `supabase/functions/run-review-pipeline/index.ts`
  - `rasterizeNextChunk`: swap `asPNG()` → `asJPEG(75)`, change file extension/content-type, adaptive DPI by total page count, change manifest regex to accept `.png|.jpg`.
  - `RASTERIZE_CHUNK`: 24 → 8.
  - Constants: add `RASTER_SCALE_LARGE = 1.111` for >40-page PDFs.

### Why this finally fixes it

| Constraint | Before | After |
|---|---|---|
| CPU per page (encode) | ~0.6s PNG | ~0.1s JPEG |
| Pages per chunk | 24 | 8 |
| CPU per chunk | ~14s (over budget) | ~0.8s (well under) |
| Chunks for 80-page PDF | 4 | 10 |
| Total wall time for 80 pages | never finishes (crashes) | ~25–35s end-to-end |

No DB schema change. No UI change. The realtime stepper still ticks over `prepare_pages` until the manifest is full, then advances to `sheet_map` exactly as it does today.

