/**
 * PDF rendering pipeline for the plan-review viewer.
 *
 * Two-phase render:
 *   1. EAGER  — render the first 10 pages immediately so the viewer is usable
 *      within ~1s on a typical plan set.
 *   2. BACKGROUND — render the remaining pages via requestIdleCallback so the
 *      UI thread stays responsive while the rest of the document streams in.
 *
 * The 10-page cap that historically made the workspace banner read
 * "first 10 of N sheets" is gone — the AI pipeline reviews every sheet
 * (chunked per-discipline). The viewer renders every page too; this hook
 * just controls *when* each page paints so 78-page sets don't freeze
 * triage for 8 seconds.
 */
import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { renderPDFPagesToImages, getPDFPageCount, type PDFPageImage } from "@/lib/pdf-utils";
import type { PlanReviewRow } from "@/types";

const EAGER_PAGE_BUDGET = 10;

export type RenderPhase = "idle" | "eager" | "background" | "done";

function scheduleIdle(cb: () => void) {
  const w = window as unknown as {
    requestIdleCallback?: (fn: () => void, opts?: { timeout: number }) => number;
  };
  if (typeof w.requestIdleCallback === "function") {
    w.requestIdleCallback(cb, { timeout: 250 });
  } else {
    setTimeout(cb, 16);
  }
}

export function usePdfPageRender() {
  const [pageImages, setPageImages] = useState<PDFPageImage[]>([]);
  const [renderingPages, setRenderingPages] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [phase, setPhase] = useState<RenderPhase>("idle");

  const renderDocumentPages = useCallback(async (r: PlanReviewRow): Promise<PDFPageImage[]> => {
    if (!r.file_urls || r.file_urls.length === 0) return [];
    setRenderingPages(true);
    setRenderProgress(0);
    setPhase("eager");

    // Fetch + decode every PDF first so we know total page count, then render.
    type LoadedFile = { fi: number; file: File; fileName: string; pageCount: number };
    const loaded: LoadedFile[] = [];
    for (let fi = 0; fi < r.file_urls.length; fi++) {
      const storedPath = r.file_urls[fi];
      if (!storedPath) continue;
      const filePath = storedPath.includes("/storage/v1/")
        ? storedPath.split("/documents/").pop() || storedPath
        : storedPath;
      const { data: signedData, error: signError } = await supabase.storage
        .from("documents")
        .createSignedUrl(filePath, 3600);
      if (signError || !signedData?.signedUrl) continue;
      const response = await fetch(signedData.signedUrl);
      const blob = await response.blob();
      const fileName = decodeURIComponent(filePath.split("/").pop() || `doc-${fi}.pdf`);
      const file = new File([blob], fileName, { type: "application/pdf" });
      let pageCount = 0;
      try {
        pageCount = await getPDFPageCount(file);
      } catch {
        pageCount = 0;
      }
      if (pageCount > 0) loaded.push({ fi, file, fileName, pageCount });
    }

    const totalPages = loaded.reduce((acc, l) => acc + l.pageCount, 0);
    if (totalPages === 0) {
      setRenderingPages(false);
      setPhase("done");
      return [];
    }

    const allImages: PDFPageImage[] = [];
    let renderedSoFar = 0;
    let baseGlobalIndex = 0;

    // Phase 1: eager — render the first EAGER_PAGE_BUDGET pages globally so
    // reviewers see something almost immediately.
    let eagerBudget = EAGER_PAGE_BUDGET;
    const deferredQueue: Array<{ load: LoadedFile; startPage: number; budget: number; baseGlobalIndex: number }> = [];

    for (const load of loaded) {
      const renderNow = Math.min(eagerBudget, load.pageCount);
      if (renderNow > 0) {
        try {
          const images = await renderPDFPagesToImages(load.file, renderNow, 150);
          for (let idx = 0; idx < images.length; idx++) {
            const img = images[idx];
            allImages.push({
              ...img,
              pageIndex: baseGlobalIndex + idx,
              fileIndex: load.fi,
              fileName: load.fileName,
              pageInFile: idx + 1,
            });
          }
          renderedSoFar += images.length;
          setPageImages([...allImages]);
          setRenderProgress(Math.min(100, (renderedSoFar / totalPages) * 100));
        } catch {
          // If page count fails, fall through; render still attempts.
        }
      }
      // Anything past the eager budget for this file goes to the background pass.
      if (load.pageCount > renderNow) {
        deferredQueue.push({
          load,
          startPage: renderNow,
          budget: load.pageCount - renderNow,
          baseGlobalIndex: baseGlobalIndex + renderNow,
        });
      }
      baseGlobalIndex += load.pageCount;
      eagerBudget = Math.max(0, eagerBudget - renderNow);
    }

    if (deferredQueue.length === 0) {
      setRenderingPages(false);
      setPhase("done");
      return allImages;
    }

    // Phase 2: background — kick the rest off without blocking the UI thread.
    setPhase("background");
    setRenderingPages(false); // viewer is interactive; banner shows progress only

    // We render full files per task to amortize PDF parse cost. Each file is
    // scheduled via idle callback so triage stays smooth.
    const runDeferred = async () => {
      for (const job of deferredQueue) {
        await new Promise<void>((resolve) => {
          scheduleIdle(async () => {
            try {
              // Render the WHOLE file (cheap — already parsed once for page count
              // but not for raster). renderPDFPagesToImages re-parses; for files
              // that already had eager pages we re-render those eager ones too
              // but discard the ones we already pushed.
              const images = await renderPDFPagesToImages(job.load.file, job.load.pageCount, 150);
              const tail = images.slice(job.startPage);
              for (let idx = 0; idx < tail.length; idx++) {
                const img = tail[idx];
                allImages.push({
                  ...img,
                  pageIndex: job.baseGlobalIndex + idx,
                  fileIndex: job.load.fi,
                  fileName: job.load.fileName,
                  pageInFile: job.startPage + idx + 1,
                });
              }
              renderedSoFar += tail.length;
              setPageImages([...allImages]);
              setRenderProgress(Math.min(100, (renderedSoFar / totalPages) * 100));
            } catch {
              /* swallow — partial coverage is better than none */
            }
            resolve();
          });
        });
      }
      setPhase("done");
    };
    // Fire-and-forget — caller already has the eager pages.
    runDeferred();

    return allImages;
  }, []);

  return {
    pageImages,
    renderingPages,
    renderProgress,
    phase,
    renderDocumentPages,
    resetPages: useCallback(() => {
      setPageImages([]);
      setPhase("idle");
      setRenderProgress(0);
    }, []),
  };
}
