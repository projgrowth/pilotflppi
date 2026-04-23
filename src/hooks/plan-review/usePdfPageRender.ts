/**
 * PDF rendering pipeline for the plan-review viewer.
 *
 * Renders ALL pages of every uploaded PDF with no artificial cap. To keep the
 * UI responsive on big sets (78+ sheets), we run two passes:
 *
 *   1. EAGER pass — render the first `EAGER_LIMIT` pages immediately so the
 *      reviewer can scroll right away. State.phase = "eager" while this runs.
 *   2. BACKGROUND pass — schedule the remaining pages via `requestIdleCallback`
 *      (falling back to `setTimeout`) so they stream in without blocking
 *      paint or interaction. State.phase = "background" while this runs,
 *      flips to "done" when complete.
 */
import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { renderPDFPagesToImages, getPDFPageCount, type PDFPageImage } from "@/lib/pdf-utils";
import type { PlanReviewRow } from "@/types";

const EAGER_LIMIT = 10;

type Phase = "idle" | "eager" | "background" | "done";

interface PreparedSource {
  fileIndex: number;
  fileName: string;
  file: File;
  pageCount: number;
}

function scheduleIdle(cb: () => void) {
  if (typeof window === "undefined") {
    cb();
    return;
  }
  const w = window as typeof window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void;
  };
  if (typeof w.requestIdleCallback === "function") {
    w.requestIdleCallback(cb, { timeout: 1500 });
  } else {
    setTimeout(cb, 50);
  }
}

export function usePdfPageRender() {
  const [pageImages, setPageImages] = useState<PDFPageImage[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [renderingPages, setRenderingPages] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  const renderDocumentPages = useCallback(async (r: PlanReviewRow): Promise<PDFPageImage[]> => {
    if (!r.file_urls || r.file_urls.length === 0) return [];
    setRenderingPages(true);
    setRenderProgress(0);
    setPhase("eager");

    try {
      // 1. Sign + fetch every PDF, count pages.
      const sources: PreparedSource[] = [];
      let total = 0;
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
        if (pageCount > 0) {
          sources.push({ fileIndex: fi, fileName, file, pageCount });
          total += pageCount;
        }
      }
      setTotalPages(total);

      // 2. EAGER pass — render the first EAGER_LIMIT pages across files.
      const eagerImages: PDFPageImage[] = [];
      let renderedSoFar = 0;
      let baseGlobal = 0;
      for (const src of sources) {
        if (renderedSoFar >= EAGER_LIMIT) {
          baseGlobal += src.pageCount;
          continue;
        }
        const want = Math.min(EAGER_LIMIT - renderedSoFar, src.pageCount);
        const imgs = await renderPDFPagesToImages(src.file, want, 150);
        eagerImages.push(
          ...imgs.map((img, idx) => ({
            ...img,
            pageIndex: baseGlobal + idx,
            fileIndex: src.fileIndex,
            fileName: src.fileName,
            pageInFile: idx + 1,
          })),
        );
        renderedSoFar += imgs.length;
        baseGlobal += src.pageCount;
        setRenderProgress(total > 0 ? (renderedSoFar / total) * 100 : 0);
      }
      setPageImages(eagerImages);

      // 3. BACKGROUND pass — render remaining pages, append in order, idle-scheduled.
      if (renderedSoFar < total) {
        setPhase("background");
        let bgRenderedSoFar = renderedSoFar;
        let bgBaseGlobal = 0;
        let leftToSkip = renderedSoFar;

        // Build per-file work descriptors (startPage, count).
        const work: Array<{ src: PreparedSource; startPage: number; count: number; baseGlobal: number }> = [];
        for (const src of sources) {
          if (leftToSkip >= src.pageCount) {
            // Whole file already rendered eagerly.
            leftToSkip -= src.pageCount;
            bgBaseGlobal += src.pageCount;
            continue;
          }
          const startPage = leftToSkip;
          const count = src.pageCount - startPage;
          work.push({ src, startPage, count, baseGlobal: bgBaseGlobal });
          bgBaseGlobal += src.pageCount;
          leftToSkip = 0;
        }

        // Run sequentially, idle-scheduled between files.
        const runBackground = async () => {
          for (const w of work) {
            await new Promise<void>((resolve) => scheduleIdle(resolve));
            try {
              const imgs = await renderPDFPagesToImages(w.src.file, w.count, 150, {
                startPage: w.startPage,
              });
              const tagged = imgs.map((img, idx) => ({
                ...img,
                pageIndex: w.baseGlobal + w.startPage + idx,
                fileIndex: w.src.fileIndex,
                fileName: w.src.fileName,
                pageInFile: w.startPage + idx + 1,
              }));
              setPageImages((prev) => {
                const next = [...prev, ...tagged];
                next.sort((a, b) => a.pageIndex - b.pageIndex);
                return next;
              });
              bgRenderedSoFar += imgs.length;
              setRenderProgress(total > 0 ? (bgRenderedSoFar / total) * 100 : 0);
            } catch {
              // Swallow per-file failures so one bad PDF doesn't stop the rest.
            }
          }
          setPhase("done");
        };
        // Fire and forget.
        void runBackground();
      } else {
        setPhase("done");
      }

      return eagerImages;
    } catch {
      setPhase("done");
      return [];
    } finally {
      setRenderingPages(false);
    }
  }, []);

  return {
    pageImages,
    phase,
    totalPages,
    /** Kept for backward compatibility with callers reading the cap-info banner.
     *  Always returns null now (no cap). */
    pageCapInfo: null as { total: number; rendered: number } | null,
    renderingPages,
    renderProgress,
    renderDocumentPages,
    resetPages: useCallback(() => {
      setPageImages([]);
      setPhase("idle");
      setTotalPages(0);
      setRenderProgress(0);
    }, []),
  };
}
