import * as pdfjsLib from "pdfjs-dist";

// Use the CDN worker for pdfjs-dist v4
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

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
 * @param maxPages - Maximum number of pages to render (default 10)
 * @param dpi - Resolution in DPI (default 150)
 */
export async function renderPDFPagesToImages(
  file: File,
  maxPages = 10,
  dpi = 150
): Promise<PDFPageImage[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const totalPages = Math.min(pdf.numPages, maxPages);
  const images: PDFPageImage[] = [];

  for (let i = 0; i < totalPages; i++) {
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

    // Cleanup
    canvas.width = 0;
    canvas.height = 0;
  }

  return images;
}

/**
 * Render a single PDF file at higher DPI for AI vision analysis.
 * Returns base64 PNGs only (display variant in renderPDFPagesToImages stays at 150 DPI).
 * 220 DPI gives the model meaningfully more pixel detail to localize against
 * without blowing up memory the way 300 DPI would.
 */
export async function renderPDFPagesForVision(
  file: File,
  maxPages = 10,
  dpi = 220
): Promise<string[]> {
  const images = await renderPDFPagesToImages(file, maxPages, dpi);
  return images.map((img) => img.base64);
}

/** Letters used for grid rows (top → bottom). Matches schema cell strings like "H7". */
const GRID_ROW_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"] as const;

/**
 * Overlay a faint 10×10 percent grid on a base64 PNG. Each cell is labelled with
 * "<rowLetter><colDigit>" (e.g. "H7" = row 8 from top, column 8 from left).
 * Cell H7 corresponds to the image region x=70-80%, y=70-80%.
 *
 * The model is instructed to return a `grid_cell` per finding, which we use as
 * the primary anchor (the raw x/y is only a refinement within that cell).
 */
async function overlayGridOnBase64(
  base64: string,
  opts: { lineColor?: string; labelColor?: string; labelBg?: string } = {}
): Promise<string> {
  const lineColor = opts.lineColor ?? "rgba(220,38,38,0.28)"; // faint red
  const labelColor = opts.labelColor ?? "rgba(220,38,38,0.95)";
  const labelBg = opts.labelBg ?? "rgba(255,255,255,0.85)";

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Failed to load page image for grid overlay"));
    img.src = base64;
  });

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);

  const w = canvas.width;
  const h = canvas.height;
  const cellW = w / 10;
  const cellH = h / 10;

  // Grid lines
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = Math.max(1, Math.round(Math.min(w, h) / 1500));
  ctx.beginPath();
  for (let i = 1; i < 10; i++) {
    const x = Math.round(i * cellW);
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    const y = Math.round(i * cellH);
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();

  // Labels — small, in the top-left corner of each cell, with white halo for readability
  const fontPx = Math.max(14, Math.round(Math.min(cellW, cellH) * 0.18));
  ctx.font = `600 ${fontPx}px ui-sans-serif, system-ui, -apple-system, "IBM Plex Sans", sans-serif`;
  ctx.textBaseline = "top";
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 10; col++) {
      const label = `${GRID_ROW_LETTERS[row]}${col}`;
      const x = col * cellW + 4;
      const y = row * cellH + 2;
      const metrics = ctx.measureText(label);
      const padX = 3;
      const padY = 1;
      ctx.fillStyle = labelBg;
      ctx.fillRect(x - padX, y - padY, metrics.width + padX * 2, fontPx + padY * 2);
      ctx.fillStyle = labelColor;
      ctx.fillText(label, x, y);
    }
  }

  return canvas.toDataURL("image/png");
}

/**
 * Render PDF pages at vision DPI AND overlay a 10×10 labelled grid on each page.
 * The model uses the visible labels (e.g. "H7") to anchor each finding to a
 * known coordinate cell, so the worst-case pin error is bounded to one cell (~10%).
 */
export async function renderPDFPagesForVisionWithGrid(
  file: File,
  maxPages = 10,
  dpi = 220
): Promise<string[]> {
  const images = await renderPDFPagesToImages(file, maxPages, dpi);
  const out: string[] = [];
  for (const img of images) {
    out.push(await overlayGridOnBase64(img.base64));
  }
  return out;
}

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
