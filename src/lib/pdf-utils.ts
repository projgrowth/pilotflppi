import * as pdfjsLib from "pdfjs-dist";

// Use the CDN worker for pdfjs-dist v4
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

export interface PDFPageImage {
  pageIndex: number;
  base64: string; // data:image/png;base64,...
  width: number;
  height: number;
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
 * Render just the first page (title block) at higher resolution for extraction.
 */
export async function renderTitleBlock(file: File): Promise<string> {
  const images = await renderPDFPagesToImages(file, 1, 200);
  return images[0]?.base64 || "";
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
