import * as pdfjsLib from "pdfjs-dist";
// Bundle the worker via Vite (`?url`) so it ships with the app instead of
// loading from a CDN. Buyers on county VPNs / hospital wifi routinely block
// cdnjs, which previously caused every page to silently rasterize to 0.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PDFPageImage {
  pageIndex: number;
  base64: string; // data:image/png;base64,...
  width: number;
  height: number;
  /** 0-based index of the source PDF in the plan_review.file_urls array. Set by the caller, not by render. */
  fileIndex?: number;
  /** Filename of the source PDF (decoded). Set by the caller. */
  fileName?: string;
  /** 1-based page number within the source PDF. Set by the caller. */
  pageInFile?: number;
}

/** A single text item extracted from a PDF page's text layer, with its bounding box in PERCENT coordinates of the rendered page. */
export interface PDFTextItem {
  /** The literal string visible on the page. */
  text: string;
  /** Center X (0-100). */
  x: number;
  /** Center Y (0-100). */
  y: number;
  /** Bounding box width as % of page width (approximation; pdfjs gives us width only). */
  width: number;
  /** Bounding box height as % of page height. */
  height: number;
}

/**
 * Extract all text items with bounding boxes (in % of page) from a PDF page.
 * This is the GROUND-TRUTH coordinate index for snapping AI pin guesses to
 * actual visible callouts/dimensions/notes — vector PDFs from architects/
 * engineers contain the text as real strings with exact coordinates, so we
 * never need to OCR them.
 */
export async function extractPagesTextItems(
  file: File,
  maxPages = 10
): Promise<PDFTextItem[][]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const totalPages = Math.min(pdf.numPages, maxPages);
  const out: PDFTextItem[][] = [];

  for (let i = 0; i < totalPages; i++) {
    const page = await pdf.getPage(i + 1);
    // Use scale=1 viewport so transform values are in PDF user space, then
    // normalize against viewport dimensions to get percent coords.
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: PDFTextItem[] = [];
    for (const it of content.items) {
      // pdfjs TextItem: { str, transform: [a,b,c,d,e,f], width, height }
      const item = it as { str?: string; transform?: number[]; width?: number; height?: number };
      const str = (item.str || "").trim();
      if (!str) continue;
      const tx = item.transform || [1, 0, 0, 1, 0, 0];
      const w = item.width || 0;
      const h = item.height || Math.abs(tx[3]) || 8;
      // pdfjs origin = bottom-left in user space; convert to top-left.
      const xPct = (tx[4] / viewport.width) * 100;
      const yTopPct = ((viewport.height - tx[5]) / viewport.height) * 100;
      const wPct = (w / viewport.width) * 100;
      const hPct = (h / viewport.height) * 100;
      items.push({
        text: str,
        x: xPct + wPct / 2,
        y: yTopPct - hPct / 2,
        width: wPct,
        height: hPct,
      });
    }
    out.push(items);
  }
  return out;
}

/**
 * Find the text item on `pageItems` whose visible string best matches `target`,
 * preferring items whose bbox center sits inside the supplied grid cell. Returns
 * null if nothing reasonable matches.
 *
 * Matching is case-insensitive and normalised: "DETAIL 3" matches "Detail 3";
 * "12" matches a callout bubble labelled "12". We require ≥ 2 chars to avoid
 * false hits on single punctuation glyphs.
 */
export function snapToNearestText(
  pageItems: PDFTextItem[],
  target: string,
  gridCellCenter: { x: number; y: number } | null
): PDFTextItem | null {
  const needle = (target || "").trim().toLowerCase();
  if (needle.length < 2) return null;

  const candidates = pageItems.filter((it) => {
    const hay = it.text.toLowerCase();
    return hay === needle || hay.includes(needle) || needle.includes(hay);
  });
  if (candidates.length === 0) return null;
  if (!gridCellCenter) {
    // No anchor — return the shortest match (most likely the exact callout).
    return candidates.sort((a, b) => Math.abs(a.text.length - needle.length) - Math.abs(b.text.length - needle.length))[0];
  }
  // Prefer the candidate whose center is closest to the AI's grid cell.
  return candidates
    .map((c) => ({ c, d: Math.hypot(c.x - gridCellCenter.x, c.y - gridCellCenter.y) }))
    .sort((a, b) => a.d - b.d)[0].c;
}

/**
 * Render specific pages of a PDF file to base64 PNG images.
 * @param file - The PDF File object
 * @param maxPages - Maximum number of pages to render. Pass `Infinity` (default)
 *                   to render every page in the document — callers that need a
 *                   cap (e.g. vision payload size) can still pass a number.
 * @param dpi - Resolution in DPI (default 150)
 * @param opts.startPage - 0-based index of the first page to render (default 0).
 *                         Useful for chunked / background rendering where the
 *                         eager pass already produced [0..startPage-1].
 */
export async function renderPDFPagesToImages(
  file: File,
  maxPages: number = Infinity,
  dpi = 150,
  opts: { startPage?: number } = {},
): Promise<PDFPageImage[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const startPage = Math.max(0, opts.startPage ?? 0);
  const endExclusive = Math.min(pdf.numPages, startPage + (Number.isFinite(maxPages) ? maxPages : pdf.numPages));
  const images: PDFPageImage[] = [];

  for (let i = startPage; i < endExclusive; i++) {
    const page = await pdf.getPage(i + 1);
    const viewport = page.getViewport({ scale: dpi / 72 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;

    await page.render({ canvasContext: ctx, viewport }).promise;

    images.push({
      pageIndex: i,
      base64: canvas.toDataURL("image/png"),
      width: viewport.width,
      height: viewport.height,
    });

    // Cleanup — explicitly release canvas memory between pages so big PDFs
    // (78+ pages at 150 DPI) don't OOM mid-render in browsers without
    // aggressive GC.
    canvas.width = 0;
    canvas.height = 0;
  }

  return images;
}

/**
 * Lightweight per-page text item shape for `plan_review_page_text.items`.
 * Coordinates are in the PDF's native user-space (origin = bottom-left,
 * units = points). Width is from pdf.js; height is approximated from the
 * transform matrix scale.
 */
export interface PageTextItem {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageTextExtraction {
  pageIndex: number;
  items: PageTextItem[];
  fullText: string;
  hasTextLayer: boolean;
}

async function renderPDFPagesToJpegs(
  file: File,
  maxPages: number = Infinity,
  dpi = 110,
  quality = 0.75,
  opts: {
    startPage?: number;
    onPage?: (pageIndex: number, total: number) => void;
    /** Called once per page with the extracted vector text layer (best-effort). */
    onText?: (extraction: PageTextExtraction) => void;
  } = {},
): Promise<Array<{ pageIndex: number; blob: Blob }>> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const startPage = Math.max(0, opts.startPage ?? 0);
  const endExclusive = Math.min(pdf.numPages, startPage + (Number.isFinite(maxPages) ? maxPages : pdf.numPages));
  const pages: Array<{ pageIndex: number; blob: Blob }> = [];

  for (let i = startPage; i < endExclusive; i++) {
    const page = await pdf.getPage(i + 1);
    const viewport = page.getViewport({ scale: dpi / 72 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;

    await page.render({ canvasContext: ctx, viewport }).promise;

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((next) => {
        if (next) resolve(next);
        else reject(new Error(`Failed to encode page ${i + 1} as JPEG`));
      }, "image/jpeg", quality);
    });

    // Best-effort vector text extraction. Wrapped so a malformed text stream
    // never poisons the rasterize path — image is the contract; text is bonus.
    if (opts.onText) {
      try {
        const content = await page.getTextContent();
        const items: PageTextItem[] = [];
        const parts: string[] = [];
        for (const raw of content.items as Array<{
          str?: string;
          transform?: number[];
          width?: number;
          height?: number;
        }>) {
          const str = (raw.str ?? "").trim();
          if (!str) continue;
          const t = raw.transform ?? [1, 0, 0, 1, 0, 0];
          const x = Number(t[4] ?? 0);
          const y = Number(t[5] ?? 0);
          const scaleY = Math.hypot(Number(t[2] ?? 0), Number(t[3] ?? 1)) || 1;
          items.push({
            text: str,
            x,
            y,
            w: Number(raw.width ?? 0),
            h: Number(raw.height ?? scaleY),
          });
          parts.push(str);
        }
        opts.onText({
          pageIndex: i,
          items,
          fullText: parts.join(" "),
          hasTextLayer: items.length > 0,
        });
      } catch {
        // Scanned PDFs with no text layer raise here — record empty extraction.
        opts.onText({ pageIndex: i, items: [], fullText: "", hasTextLayer: false });
      }
    }

    pages.push({ pageIndex: i, blob });
    // Release canvas memory before the next page.
    canvas.width = 0;
    canvas.height = 0;
    opts.onPage?.(i, pdf.numPages);
  }

  return pages;
}

/**
 * Browser-side pre-rasterization for plan-review uploads.
 *
 * Renders each PDF in `files` to JPEGs and uploads them under
 * `plan-reviews/<reviewId>/pages/<basename>/p-NNN.jpg`. Returns the manifest
 * rows ready for upsert into `plan_review_page_assets`.
 *
 * The wizard and the inline drop-zone both call this so that the edge
 * function's `prepare_pages` stage stays a fast no-op (the manifest is
 * already populated when it runs). When this fails or isn't available,
 * the edge function still rasterizes server-side as a fallback.
 *
 * Caller is responsible for upserting the returned `pageAssets` into
 * `plan_review_page_assets` and updating `plan_reviews.ai_run_progress`
 * with `{ pre_rasterized: true, pre_rasterized_pages: N }`.
 */
export interface PreparedPageAsset {
  plan_review_id: string;
  source_file_path: string;
  page_index: number;
  storage_path: string;
  status: "ready";
}

/**
 * Result of a resilient rasterize+upload pass. `succeeded` always reflects the
 * rows that uploaded cleanly; `failures` lists per-page reasons so the caller
 * can surface "Rasterized 77 of 78 — 1 failed" instead of dropping the whole
 * batch on a single hiccup.
 */
export interface RasterizeResult {
  succeeded: PreparedPageAsset[];
  failures: Array<{ fileName: string; pageIndex: number; reason: string }>;
}

export async function rasterizeAndUploadPages(
  reviewId: string,
  files: Array<{ name: string; file: File; storagePath: string; pageCount: number }>,
  uploadFn: (path: string, blob: Blob) => Promise<{ error: { message: string } | null }>,
  opts: {
    dpi?: number;
    quality?: number;
    startGlobalIndex?: number;
    /** Render in chunks of this many pages, releasing memory between chunks. */
    batchSize?: number;
    /** Firm-scoped pages prefix; see `rasterizeAndUploadPagesResilient`. */
    pagesPrefix?: string;
  } = {},
): Promise<PreparedPageAsset[]> {
  const result = await rasterizeAndUploadPagesResilient(reviewId, files, uploadFn, opts);
  return result.succeeded;
}

/**
 * Resilient variant — returns BOTH the successful rows and per-page failures.
 * Prefer this in new callers; the legacy `rasterizeAndUploadPages` returns
 * only `succeeded` for backward compatibility with the upload toast.
 */
export async function rasterizeAndUploadPagesResilient(
  reviewId: string,
  files: Array<{ name: string; file: File; storagePath: string; pageCount: number }>,
  uploadFn: (path: string, blob: Blob) => Promise<{ error: { message: string } | null }>,
  opts: {
    dpi?: number;
    quality?: number;
    startGlobalIndex?: number;
    batchSize?: number;
    /** Per-chunk render timeout in ms. A stuck PDF.js worker won't freeze the wizard. */
    chunkTimeoutMs?: number;
    /** Total wall-clock cap; once exceeded, remaining pages are abandoned and left to the server-side rasterizer. */
    totalTimeoutMs?: number;
    /** If failure ratio exceeds this (0-1), abort and let server fallback handle the rest. */
    abortFailureRatio?: number;
    /** Called after each page completes (success or failure). */
    onProgress?: (done: number, total: number) => void;
    /** Called after each successfully uploaded page so callers can persist incrementally. */
    onPageReady?: (asset: PreparedPageAsset) => void | Promise<void>;
    /**
     * Called with the extracted vector text layer for each page that was
     * successfully rendered. `globalPageIndex` matches the asset's
     * `page_index` so the caller can upsert directly into
     * `plan_review_page_text`. Best-effort — not invoked for failed renders.
     */
    onPageText?: (extraction: PageTextExtraction & {
      globalPageIndex: number;
      sourceFilePath: string;
    }) => void | Promise<void>;
    /**
     * Required for firm-scoped storage: page JPEGs are written to
     * `<pagesPrefix>/<basename>/p-NNN.jpg`. Callers should pass
     * `firms/<firmId>/plan-reviews/<reviewId>/pages` so the new
     * storage RLS + CHECK constraint accept the path.
     */
    pagesPrefix?: string;
  } = {},
): Promise<RasterizeResult & { aborted?: boolean }> {
  const dpi = opts.dpi ?? 96;
  const quality = opts.quality ?? 0.72;
  const batchSize = Math.max(1, opts.batchSize ?? 4);
  const chunkTimeoutMs = opts.chunkTimeoutMs ?? 30_000;
  const totalTimeoutMs = opts.totalTimeoutMs ?? 5 * 60_000;
  const abortFailureRatio = opts.abortFailureRatio ?? 0.4;
  // Legacy `plan-reviews/<id>/pages` path is no longer accepted by storage RLS
  // or the CHECK constraint. Callers must pass a firm-scoped `pagesPrefix`.
  const pagesPrefix = opts.pagesPrefix ?? `plan-reviews/${reviewId}/pages`;
  const startedAt = Date.now();
  let nextGlobalPageIndex = opts.startGlobalIndex ?? 0;
  const succeeded: PreparedPageAsset[] = [];
  const totalPages = files.reduce((sum, f) => sum + (f.pageCount || 0), 0);
  let processed = 0;
  let aborted = false;
  const failures: Array<{ fileName: string; pageIndex: number; reason: string }> = [];

  for (const uf of files) {
    if (aborted) break;
    const isPdf = uf.file.type === "application/pdf" || uf.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) continue;

    // Render in batches of `batchSize` so a 78-page PDF doesn't try to keep
    // every canvas alive simultaneously. Browsers without aggressive GC will
    // OOM mid-PDF if we render all pages first then upload.
    for (let chunkStart = 0; chunkStart < uf.pageCount; chunkStart += batchSize) {
      if (aborted) break;

      // Global timeout — abandon remaining pages and let the server-side
      // rasterizer pick up the slack. This is the key fix that prevents the
      // wizard from hanging forever on a stuck PDF.js worker.
      if (Date.now() - startedAt > totalTimeoutMs) {
        aborted = true;
        for (let p = chunkStart; p < uf.pageCount; p++) {
          failures.push({ fileName: uf.name, pageIndex: p, reason: "aborted: total timeout" });
          nextGlobalPageIndex += 1;
          processed += 1;
          opts.onProgress?.(processed, totalPages);
        }
        break;
      }

      const chunkLen = Math.min(batchSize, uf.pageCount - chunkStart);
      let pageJpegs: Array<{ pageIndex: number; blob: Blob }> = [];
      // Map of file-local pageIndex → extracted text. Populated synchronously
      // by `renderPDFPagesToJpegs` via its `onText` callback so we can replay
      // it after the JPEG upload settles (and only for pages that uploaded
      // cleanly — there's no point persisting text for a missing image).
      const textByLocalIndex = new Map<number, PageTextExtraction>();
      try {
        pageJpegs = await Promise.race<Array<{ pageIndex: number; blob: Blob }>>([
          renderPDFPagesToJpegs(uf.file, chunkLen, dpi, quality, {
            startPage: chunkStart,
            onText: opts.onPageText
              ? (extraction) => {
                  textByLocalIndex.set(extraction.pageIndex, extraction);
                }
              : undefined,
          }),
          new Promise<Array<{ pageIndex: number; blob: Blob }>>((_, reject) =>
            setTimeout(() => reject(new Error(`chunk render timed out after ${chunkTimeoutMs}ms`)), chunkTimeoutMs),
          ),
        ]);
      } catch (err) {
        for (let p = chunkStart; p < chunkStart + chunkLen; p++) {
          failures.push({
            fileName: uf.name,
            pageIndex: p,
            reason: `render: ${err instanceof Error ? err.message : String(err)}`,
          });
          nextGlobalPageIndex += 1;
          processed += 1;
          opts.onProgress?.(processed, totalPages);
        }
        // Abort threshold check — if too many pages are failing, give up and
        // let the server-side rasterizer finish.
        if (processed > 0 && failures.length / processed >= abortFailureRatio && processed >= 6) {
          aborted = true;
          break;
        }
        continue;
      }

      // Upload all pages in this chunk in parallel; settle so a single failure
      // doesn't take down the rest.
      const baseName = uf.name.replace(/\.pdf$/i, "");
      const settled = await Promise.allSettled(
        pageJpegs.map(async (page) => {
          const pagePath = `${pagesPrefix}/${baseName}/p-${String(page.pageIndex).padStart(3, "0")}.jpg`;
          const { error: pageUploadError } = await uploadFn(pagePath, page.blob);
          if (pageUploadError) throw new Error(pageUploadError.message);
          return { page, pagePath };
        }),
      );

      for (let i = 0; i < settled.length; i++) {
        const s = settled[i];
        const page = pageJpegs[i];
        if (s.status === "fulfilled") {
          const asset: PreparedPageAsset = {
            plan_review_id: reviewId,
            source_file_path: uf.storagePath,
            page_index: nextGlobalPageIndex,
            storage_path: s.value.pagePath,
            status: "ready",
          };
          succeeded.push(asset);
          if (opts.onPageReady) {
            try { await opts.onPageReady(asset); } catch { /* incremental persist is best-effort */ }
          }
          // Persist the page text alongside the asset using the same global
          // page_index, so downstream stages can join 1:1.
          if (opts.onPageText) {
            const extraction = textByLocalIndex.get(page.pageIndex);
            if (extraction) {
              try {
                await opts.onPageText({
                  ...extraction,
                  globalPageIndex: nextGlobalPageIndex,
                  sourceFilePath: uf.storagePath,
                });
              } catch { /* best-effort; image upload already succeeded */ }
            }
          }
        } else {
          failures.push({
            fileName: uf.name,
            pageIndex: page.pageIndex,
            reason: `upload: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`,
          });
        }
        nextGlobalPageIndex += 1;
        processed += 1;
        opts.onProgress?.(processed, totalPages);
      }
    }
  }

  return { succeeded, failures, aborted };
}

// renderPDFPagesForVision removed — superseded by browser-side resilient
// rasterization in rasterizeAndUploadPagesResilient (used by uploadPlanReviewFiles
// and reprepareInBrowser). The 10-page cap baked into this helper was already
// blocking every plan review > 10 pages, and it had no remaining callers.

/** Letters used for grid rows (top → bottom). Matches schema cell strings like "H7". */
const GRID_ROW_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"] as const;

// overlayGridOnBase64 removed — only used by the deleted
// renderPDFPagesForVisionWithGrid path. Pin placement still uses
// gridCellToCenter() below for grid-cell → percent conversion.

// renderPDFPagesForVisionWithGrid removed — same reason as renderPDFPagesForVision
// above. The grid-overlay path was only used by the long-deleted server-side
// rasterizer; vision pages are now uploaded as plain rasterized JPEGs.

/**
 * Convert a grid cell label like "H7" to percent center coords (0-100).
 * Returns null if the label is malformed.
 */
export function gridCellToCenter(cell: string | undefined | null): { x: number; y: number } | null {
  if (!cell || typeof cell !== "string") return null;
  const trimmed = cell.trim().toUpperCase();
  const m = trimmed.match(/^([A-J])([0-9])$/);
  if (!m) return null;
  const rowIdx = GRID_ROW_LETTERS.indexOf(m[1] as typeof GRID_ROW_LETTERS[number]);
  const colIdx = parseInt(m[2], 10);
  if (rowIdx < 0 || isNaN(colIdx)) return null;
  return { x: colIdx * 10 + 5, y: rowIdx * 10 + 5 };
}

/**
 * Render just the first page's title block region for extraction.
 *
 * Title blocks live on the right ~32% (or bottom ~25%) of the sheet. We render
 * the full page at modest DPI, then crop to the title-block strip and emit JPEG.
 * This keeps the base64 payload small enough to fit in edge-function memory
 * (~150MB hard cap) — a full 200 DPI E-size PNG was hitting that limit.
 */
export async function renderTitleBlock(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 130 / 72 }); // 130 DPI is plenty for text OCR
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport }).promise;

  // Crop to right 32% of the sheet (where title blocks almost always live on
  // landscape architectural/engineering plans). Fall back to bottom 28% strip
  // composed beneath it so portrait sheets and bottom-aligned blocks still work.
  const w = canvas.width;
  const h = canvas.height;
  const rightW = Math.round(w * 0.32);
  const bottomH = Math.round(h * 0.28);

  const out = document.createElement("canvas");
  out.width = rightW + w; // right strip + bottom strip side by side
  out.height = Math.max(h, bottomH);
  const octx = out.getContext("2d")!;
  octx.fillStyle = "#ffffff";
  octx.fillRect(0, 0, out.width, out.height);
  // Right strip (full height)
  octx.drawImage(canvas, w - rightW, 0, rightW, h, 0, 0, rightW, h);
  // Bottom strip (full width) placed to the right of the right strip
  octx.drawImage(canvas, 0, h - bottomH, w, bottomH, rightW, 0, w, bottomH);

  // Cleanup full-page canvas
  canvas.width = 0;
  canvas.height = 0;

  // JPEG at quality 0.75 — title-block text stays crisp, payload shrinks ~5×
  const dataUrl = out.toDataURL("image/jpeg", 0.75);
  out.width = 0;
  out.height = 0;
  return dataUrl;
}

/**
 * Render a high-DPI crop of a specific grid cell + its 8 neighbors (3×3 region)
 * from a single PDF page. Used for the SECOND-PASS zoom on low-confidence pins:
 * the model sees ~30% of the sheet at effectively 4× the pixel density of the
 * first pass, so previously unreadable callouts become legible.
 *
 * Returns: {
 *   base64: data:image/jpeg crop,
 *   crop: {x,y,width,height} in PERCENT of the full page (so we can transform
 *         model-returned coords back into full-page coordinates).
 * }
 */
/**
 * Render specific (1-based) page numbers from a PDF and return them as JPEG
 * blobs. Used by the gap-only re-rasterize path: when 1 of 78 pages failed
 * the first time, we don't want to re-render the other 77 from scratch.
 *
 * `pageNumbersInFile` are 1-based pdf.js page numbers. Returns one entry per
 * input number (in the same order); throws on getPage failure for any single
 * page so the caller can record a per-page failure and continue.
 */
export async function rasterizePagesByIndex(
  file: File,
  pageNumbersInFile: number[],
  dpi = 96,
  quality = 0.72,
): Promise<Array<{ pageInFile: number; blob: Blob }>> {
  if (pageNumbersInFile.length === 0) return [];
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const out: Array<{ pageInFile: number; blob: Blob }> = [];
  for (const n of pageNumbersInFile) {
    if (n < 1 || n > pdf.numPages) {
      throw new Error(`Page ${n} out of range (PDF has ${pdf.numPages})`);
    }
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: dpi / 72 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((next) => {
        if (next) resolve(next);
        else reject(new Error(`Failed to encode page ${n} as JPEG`));
      }, "image/jpeg", quality);
    });
    out.push({ pageInFile: n, blob });
    canvas.width = 0;
    canvas.height = 0;
  }
  return out;
}

/**
 * Get page count without rendering.
 */
export async function getPDFPageCount(file: File): Promise<number> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  return pdf.numPages;
}

/**
 * Validate that a file is actually a PDF (check magic bytes).
 */
export function validatePDFHeader(file: File): Promise<boolean> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const arr = new Uint8Array(reader.result as ArrayBuffer);
      // PDF magic bytes: %PDF
      const header = String.fromCharCode(arr[0], arr[1], arr[2], arr[3]);
      resolve(header === "%PDF");
    };
    reader.onerror = () => resolve(false);
    reader.readAsArrayBuffer(file.slice(0, 4));
  });
}
