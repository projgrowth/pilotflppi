// Resolve a finding's first sheet_ref → the underlying PDF file + page number,
// fetch the PDF (cached in-memory per session), generate a cropped PNG of the
// region around the AI's verbatim evidence quote, and cache the result for
// the lifetime of the page.
//
// Strategy:
//   sheet_refs[0] (e.g. "A-101")
//     → sheet_coverage row { page_index, plan_review_id }   (already on dashboard)
//     → plan_review_files row(s) sorted by upload order — page_index counts
//       across files in upload order, so we walk file lengths to find which
//       file contains the page and the 1-based page number within it.
//
// We avoid hitting Storage twice for the same PDF in the same session by
// caching the File objects in a module-level Map keyed by file_path.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { generateEvidenceCrop, type EvidenceCropResult } from "@/lib/evidence-crop";

interface ResolveOpts {
  planReviewId: string;
  sheetRef: string | null;
  evidenceText: string;
  enabled: boolean;
}

interface FetchedPdf {
  file: File;
  numPages: number;
}

const fileCache = new Map<string, Promise<FetchedPdf>>();
const cropCache = new Map<string, EvidenceCropResult>();

async function fetchPdf(filePath: string): Promise<FetchedPdf> {
  const cached = fileCache.get(filePath);
  if (cached) return cached;
  const promise = (async () => {
    const { data, error } = await supabase.storage
      .from("documents")
      .createSignedUrl(filePath, 60 * 60);
    if (error || !data?.signedUrl) {
      throw new Error(error?.message ?? "Could not sign PDF URL");
    }
    const res = await fetch(data.signedUrl);
    if (!res.ok) throw new Error(`Fetch PDF failed: ${res.status}`);
    const blob = await res.blob();
    const file = new File([blob], filePath.split("/").pop() ?? "plan.pdf", {
      type: "application/pdf",
    });
    // We need numPages for the upload-order page resolution. Use pdf.js header parse only.
    const pdfjsLib = await import("pdfjs-dist");
    const ab = await file.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: ab }).promise;
    return { file, numPages: doc.numPages };
  })();
  fileCache.set(filePath, promise);
  return promise;
}

export interface UseEvidenceCropState {
  status: "idle" | "loading" | "ready" | "error" | "no_match";
  result: EvidenceCropResult | null;
  pageInFile: number | null;
  filePath: string | null;
  error: string | null;
}

/**
 * Lazily resolve and render an evidence crop for a finding. Pass enabled=true
 * only when the user expands the evidence panel — this hook does heavy work
 * (PDF fetch + render) and we don't want it firing for every card on screen.
 */
export function useEvidenceCrop(opts: ResolveOpts): UseEvidenceCropState {
  const { planReviewId, sheetRef, evidenceText, enabled } = opts;
  const cacheKey = `${planReviewId}::${sheetRef ?? "?"}::${evidenceText.slice(0, 80)}`;
  const [state, setState] = useState<UseEvidenceCropState>(() => {
    const cached = cropCache.get(cacheKey);
    if (cached) {
      return {
        status: "ready",
        result: cached,
        pageInFile: null,
        filePath: null,
        error: null,
      };
    }
    return { status: "idle", result: null, pageInFile: null, filePath: null, error: null };
  });

  useEffect(() => {
    if (!enabled || !sheetRef || !evidenceText.trim() || !planReviewId) return;
    if (state.status === "ready" || state.status === "loading") return;

    let cancelled = false;
    setState((s) => ({ ...s, status: "loading", error: null }));

    (async () => {
      try {
        // 1) sheet_ref → page_index
        const sheetUpper = sheetRef.toUpperCase().trim();
        const { data: sheetRow, error: sheetErr } = await supabase
          .from("sheet_coverage")
          .select("page_index")
          .eq("plan_review_id", planReviewId)
          .eq("sheet_ref", sheetUpper)
          .maybeSingle();
        if (sheetErr) throw sheetErr;
        if (!sheetRow || sheetRow.page_index == null) {
          if (!cancelled) {
            setState({
              status: "no_match",
              result: null,
              pageInFile: null,
              filePath: null,
              error: "Sheet not in coverage map",
            });
          }
          return;
        }
        const targetPageIdx = sheetRow.page_index as number;

        // 2) Walk plan_review_files in upload order to map page_index → (file, page-in-file)
        const { data: files, error: filesErr } = await supabase
          .from("plan_review_files")
          .select("file_path, uploaded_at, round")
          .eq("plan_review_id", planReviewId)
          .order("round", { ascending: true })
          .order("uploaded_at", { ascending: true });
        if (filesErr) throw filesErr;
        if (!files || files.length === 0) throw new Error("No PDF files for review");

        let cumulative = 0;
        let chosen: { file: File; pageInFile: number; filePath: string } | null = null;
        for (const f of files) {
          const fetched = await fetchPdf(f.file_path);
          if (targetPageIdx < cumulative + fetched.numPages) {
            chosen = {
              file: fetched.file,
              pageInFile: targetPageIdx - cumulative + 1,
              filePath: f.file_path,
            };
            break;
          }
          cumulative += fetched.numPages;
        }
        if (!chosen) throw new Error("page_index out of range");

        // 3) Render + crop
        const result = await generateEvidenceCrop({
          file: chosen.file,
          pageInFile: chosen.pageInFile,
          evidenceText,
        });
        cropCache.set(cacheKey, result);
        if (!cancelled) {
          setState({
            status: "ready",
            result,
            pageInFile: chosen.pageInFile,
            filePath: chosen.filePath,
            error: null,
          });
        }
      } catch (e) {
        if (!cancelled) {
          setState({
            status: "error",
            result: null,
            pageInFile: null,
            filePath: null,
            error: e instanceof Error ? e.message : "Unknown error",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, planReviewId, sheetRef, evidenceText]);

  return state;
}
