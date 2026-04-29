import { supabase } from "@/integrations/supabase/client";
import {
  getPDFPageCount,
  rasterizeAndUploadPages,
  rasterizePagesByIndex,
  validatePDFHeader,
} from "@/lib/pdf-utils";
import { startPipeline } from "@/lib/pipeline-run";
import { normalizeStorageKey } from "@/lib/storage-paths";

/**
 * Re-runs browser rasterization for an already-uploaded plan review.
 *
 * Two modes:
 *
 * 1. **Full rebuild** — when no `plan_review_page_assets` rows exist yet
 *    (or `expected_pages` is unknown). Wipes nothing extra; renders every
 *    page from every source PDF. This is the historical behavior used by
 *    the recovery banner after a fresh `needs_browser_rasterization`.
 *
 * 2. **Gap-only repair** — when the manifest already has SOME rows but is
 *    missing one or more page indices vs `ai_run_progress.expected_pages`.
 *    Renders only the missing pages, INSERTs new rows (the unique index on
 *    `(plan_review_id, page_index)` prevents collisions), then kicks the
 *    pipeline. A 78-page review missing 1 page repairs in ~3s instead of
 *    re-rendering all 78.
 *
 * Returns a structured result so the caller can show one accurate toast.
 */
export interface ReprepareResult {
  ok: boolean;
  message: string;
  pageAssetCount: number;
  /** When set, indicates a gap-only repair (vs full rebuild). */
  repairedCount?: number;
  pipelineStarted: boolean;
  warnings: string[];
}

interface GapPlan {
  /** 0-based global page indices we still need. */
  missingGlobalIndices: number[];
  /** Global index → which file (0-based) it belongs to and 1-based page within that file. */
  indexMap: Map<number, { fileIdx: number; pageInFile: number }>;
}

interface SourceFile {
  name: string;
  storagePath: string;
  file: File;
  pageCount: number;
  /** 0-based global page index this file's first page maps to. */
  globalStart: number;
}

async function downloadAndValidate(
  storagePath: string,
  warnings: string[],
): Promise<{ file: File; pageCount: number } | null> {
  const key = normalizeStorageKey(storagePath);
  const name = key.split("/").pop() ?? "plan.pdf";
  const { data: signed, error: signErr } = await supabase.storage
    .from("documents")
    .createSignedUrl(key, 60 * 10);
  if (signErr || !signed) {
    warnings.push(`${name}: ${signErr?.message ?? "could not sign URL"}`);
    return null;
  }
  try {
    const res = await fetch(signed.signedUrl);
    if (!res.ok) {
      warnings.push(`${name}: download failed (HTTP ${res.status})`);
      return null;
    }
    const blob = await res.blob();
    const file = new File([blob], name, { type: "application/pdf" });
    const isPdf = await validatePDFHeader(file);
    if (!isPdf) {
      warnings.push(`${name}: file is not a valid PDF (bad magic bytes)`);
      return null;
    }
    const pageCount = await getPDFPageCount(file);
    if (pageCount <= 0) {
      warnings.push(`${name}: PDF reports 0 pages`);
      return null;
    }
    return { file, pageCount };
  } catch (err) {
    warnings.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function planGapRepair(
  sources: SourceFile[],
  existingIndices: Set<number>,
  expectedPages: number,
): GapPlan {
  const indexMap = new Map<number, { fileIdx: number; pageInFile: number }>();
  for (let fIdx = 0; fIdx < sources.length; fIdx++) {
    const s = sources[fIdx];
    for (let p = 0; p < s.pageCount; p++) {
      indexMap.set(s.globalStart + p, { fileIdx: fIdx, pageInFile: p + 1 });
    }
  }
  const missing: number[] = [];
  for (let i = 0; i < expectedPages; i++) {
    if (!existingIndices.has(i)) missing.push(i);
  }
  return { missingGlobalIndices: missing, indexMap };
}

export async function reprepareInBrowser(reviewId: string): Promise<ReprepareResult> {
  const warnings: string[] = [];

  // 1. Source PDFs from plan_review_files.
  const { data: rows, error: filesErr } = await supabase
    .from("plan_review_files")
    .select("file_path")
    .eq("plan_review_id", reviewId)
    .order("uploaded_at", { ascending: true });
  if (filesErr) {
    return { ok: false, message: filesErr.message, pageAssetCount: 0, pipelineStarted: false, warnings };
  }
  const sourcePdfs = (rows ?? []).filter((r) => r.file_path.toLowerCase().endsWith(".pdf"));
  if (sourcePdfs.length === 0) {
    return {
      ok: false,
      message: "No PDF files found for this review — re-upload from the project page.",
      pageAssetCount: 0,
      pipelineStarted: false,
      warnings,
    };
  }

  // 2. Existing manifest + expected total (if upload stamped it).
  const [{ data: existingAssets }, { data: reviewRow }] = await Promise.all([
    supabase
      .from("plan_review_page_assets")
      .select("page_index")
      .eq("plan_review_id", reviewId),
    supabase
      .from("plan_reviews")
      .select("ai_run_progress, firm_id")
      .eq("id", reviewId)
      .maybeSingle(),
  ]);
  const firmId = reviewRow?.firm_id ?? null;
  if (!firmId) {
    return {
      ok: false,
      message: "Cannot reprepare: review is missing firm context.",
      pageAssetCount: 0,
      pipelineStarted: false,
      warnings,
    };
  }
  const pagesPrefix = `firms/${firmId}/plan-reviews/${reviewId}/pages`;
  const existingIndices = new Set<number>(
    ((existingAssets ?? []) as Array<{ page_index: number }>).map((r) => r.page_index),
  );
  const progress = (reviewRow?.ai_run_progress ?? {}) as Record<string, unknown>;
  const expectedPagesFromProgress =
    typeof progress.expected_pages === "number" ? (progress.expected_pages as number) : null;

  // 3. Download + validate every source PDF (we need page counts either way).
  const sources: SourceFile[] = [];
  let runningStart = 0;
  for (const r of sourcePdfs) {
    const key = normalizeStorageKey(r.file_path);
    const ok = await downloadAndValidate(key, warnings);
    if (!ok) continue;
    sources.push({
      name: key.split("/").pop() ?? "plan.pdf",
      storagePath: key,
      file: ok.file,
      pageCount: ok.pageCount,
      globalStart: runningStart,
    });
    runningStart += ok.pageCount;
  }
  if (sources.length === 0) {
    return {
      ok: false,
      message: warnings.join("; ") || "No usable PDFs after validation",
      pageAssetCount: 0,
      pipelineStarted: false,
      warnings,
    };
  }
  const computedExpected = sources.reduce((s, f) => s + f.pageCount, 0);
  const expectedPages = expectedPagesFromProgress ?? computedExpected;

  // 4. Decide path: gap-repair vs full rebuild.
  const isGapRepair =
    existingIndices.size > 0 && existingIndices.size < expectedPages;

  if (isGapRepair) {
    const plan = planGapRepair(sources, existingIndices, expectedPages);
    if (plan.missingGlobalIndices.length === 0) {
      // Manifest is actually complete — just kick the pipeline.
      const pipeline = await startPipeline(reviewId, "core", "prepare_pages");
      return {
        ok: pipeline.ok,
        message: pipeline.ok
          ? "All pages already prepared — restarted the pipeline."
          : `Pipeline failed to start: ${pipeline.message ?? "unknown"}`,
        pageAssetCount: existingIndices.size,
        repairedCount: 0,
        pipelineStarted: pipeline.ok,
        warnings,
      };
    }

    // Group missing indices by source file so we render each PDF once.
    const byFile = new Map<number, number[]>();
    for (const gIdx of plan.missingGlobalIndices) {
      const m = plan.indexMap.get(gIdx);
      if (!m) continue;
      if (!byFile.has(m.fileIdx)) byFile.set(m.fileIdx, []);
      byFile.get(m.fileIdx)!.push(m.pageInFile);
    }

    const newRows: Array<{
      plan_review_id: string;
      source_file_path: string;
      page_index: number;
      storage_path: string;
      status: "ready";
    }> = [];
    let repairedCount = 0;

    for (const [fileIdx, pages] of byFile) {
      const src = sources[fileIdx];
      try {
        const rendered = await rasterizePagesByIndex(src.file, pages.sort((a, b) => a - b));
        const baseName = src.name.replace(/\.pdf$/i, "");
        for (const r of rendered) {
          const globalIdx = src.globalStart + (r.pageInFile - 1);
          const pagePath = `plan-reviews/${reviewId}/pages/${baseName}/p-${String(globalIdx).padStart(3, "0")}.jpg`;
          const { error: upErr } = await supabase.storage
            .from("documents")
            .upload(pagePath, r.blob, { upsert: true, contentType: "image/jpeg" });
          if (upErr) {
            warnings.push(`${src.name} page ${r.pageInFile}: ${upErr.message}`);
            continue;
          }
          newRows.push({
            plan_review_id: reviewId,
            source_file_path: src.storagePath,
            page_index: globalIdx,
            storage_path: pagePath,
            status: "ready",
          });
          repairedCount++;
        }
      } catch (err) {
        warnings.push(`${src.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (newRows.length > 0) {
      const { error: insErr } = await supabase
        .from("plan_review_page_assets")
        .upsert(newRows, { onConflict: "plan_review_id,page_index" });
      if (insErr) {
        return {
          ok: false,
          message: `Manifest write failed: ${insErr.message}`,
          pageAssetCount: existingIndices.size,
          repairedCount: 0,
          pipelineStarted: false,
          warnings,
        };
      }
    }

    // Re-stamp progress so verify stage trusts the new total.
    const newTotal = existingIndices.size + newRows.length;
    await supabase
      .from("plan_reviews")
      .update({
        ai_run_progress: {
          ...(progress as Record<string, unknown>),
          pre_rasterized: true,
          pre_rasterized_pages: newTotal,
          expected_pages: expectedPages,
          last_gap_repair_at: new Date().toISOString(),
          last_gap_repaired_count: repairedCount,
        },
      })
      .eq("id", reviewId);

    const pipeline = await startPipeline(reviewId, "core", "prepare_pages");
    if (!pipeline.ok) {
      return {
        ok: false,
        message: `Repaired ${repairedCount} page(s) but pipeline failed to start: ${pipeline.message ?? "unknown"}`,
        pageAssetCount: newTotal,
        repairedCount,
        pipelineStarted: false,
        warnings,
      };
    }
    return {
      ok: true,
      message: `Repaired ${repairedCount} of ${expectedPages} page(s) and restarted the pipeline.`,
      pageAssetCount: newTotal,
      repairedCount,
      pipelineStarted: true,
      warnings,
    };
  }

  // 5. Full rebuild path (no existing manifest, or all pages missing).
  const pairs = sources.map((s) => ({
    name: s.name,
    file: s.file,
    storagePath: s.storagePath,
    pageCount: s.pageCount,
  }));

  const pageAssetRows = await rasterizeAndUploadPages(
    reviewId,
    pairs,
    async (path, blob) => {
      const res = await supabase.storage
        .from("documents")
        .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
      return { error: res.error ? { message: res.error.message } : null };
    },
    { startGlobalIndex: 0 },
  );

  if (pageAssetRows.length === 0) {
    return {
      ok: false,
      message: "Rasterization produced 0 page assets — the source PDFs may be corrupt.",
      pageAssetCount: 0,
      pipelineStarted: false,
      warnings,
    };
  }

  await supabase.from("plan_review_page_assets").delete().eq("plan_review_id", reviewId);
  const { error: assetErr } = await supabase
    .from("plan_review_page_assets")
    .insert(pageAssetRows);
  if (assetErr) {
    return {
      ok: false,
      message: `Manifest write failed: ${assetErr.message}`,
      pageAssetCount: pageAssetRows.length,
      pipelineStarted: false,
      warnings,
    };
  }

  await supabase
    .from("plan_reviews")
    .update({
      ai_run_progress: {
        ...(progress as Record<string, unknown>),
        pre_rasterized: true,
        pre_rasterized_pages: pageAssetRows.length,
        expected_pages: expectedPages,
      },
    })
    .eq("id", reviewId);

  const pipeline = await startPipeline(reviewId, "core", "prepare_pages");
  if (!pipeline.ok) {
    return {
      ok: false,
      message: `Pages re-prepared but pipeline failed to start: ${pipeline.message ?? "unknown"}`,
      pageAssetCount: pageAssetRows.length,
      pipelineStarted: false,
      warnings,
    };
  }

  return {
    ok: true,
    message: `Re-prepared ${pageAssetRows.length} page(s) and restarted the pipeline.`,
    pageAssetCount: pageAssetRows.length,
    pipelineStarted: true,
    warnings,
  };
}
