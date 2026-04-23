import { supabase } from "@/integrations/supabase/client";
import {
  getPDFPageCount,
  rasterizeAndUploadPages,
  rasterizeAndUploadVisionPages,
  validatePDFHeader,
} from "@/lib/pdf-utils";
import { startPipeline } from "@/lib/pipeline-run";

/**
 * Re-runs browser rasterization for an already-uploaded plan review.
 *
 * The server `prepare_pages` stage is verify-only — it cannot rasterize
 * PDFs (Supabase Edge's CPU budget can't fit MuPDF cold-load + decode +
 * encode + upload). When that stage errors with `needs_browser_rasterization`,
 * call this helper to download the existing source PDFs from storage,
 * rasterize them locally with pdf.js, upsert the page manifest, then
 * restart the pipeline.
 *
 * Returns a structured result so the caller can show one accurate toast.
 */
export interface ReprepareResult {
  ok: boolean;
  message: string;
  pageAssetCount: number;
  pipelineStarted: boolean;
  warnings: string[];
}

export async function reprepareInBrowser(reviewId: string): Promise<ReprepareResult> {
  const warnings: string[] = [];

  // 1. List source PDFs already in plan_review_files for this review.
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

  // 2. Sign + fetch each PDF, validate header, count pages.
  const pairs: Array<{ name: string; file: File; storagePath: string; pageCount: number }> = [];
  for (const r of sourcePdfs) {
    const path = r.file_path;
    const name = path.split("/").pop() ?? "plan.pdf";
    const { data: signed, error: signErr } = await supabase.storage
      .from("documents")
      .createSignedUrl(path, 60 * 10);
    if (signErr || !signed) {
      warnings.push(`${name}: ${signErr?.message ?? "could not sign URL"}`);
      continue;
    }
    try {
      const res = await fetch(signed.signedUrl);
      if (!res.ok) {
        warnings.push(`${name}: download failed (HTTP ${res.status})`);
        continue;
      }
      const blob = await res.blob();
      const file = new File([blob], name, { type: "application/pdf" });
      const isPdf = await validatePDFHeader(file);
      if (!isPdf) {
        warnings.push(`${name}: file is not a valid PDF (bad magic bytes)`);
        continue;
      }
      const pageCount = await getPDFPageCount(file);
      if (pageCount <= 0) {
        warnings.push(`${name}: PDF reports 0 pages`);
        continue;
      }
      pairs.push({ name, file, storagePath: path, pageCount });
    } catch (err) {
      warnings.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (pairs.length === 0) {
    return {
      ok: false,
      message: warnings.join("; ") || "No usable PDFs after validation",
      pageAssetCount: 0,
      pipelineStarted: false,
      warnings,
    };
  }

  // 3. Rasterize + upload + collect manifest rows (display + vision).
  let pageAssetRows = await rasterizeAndUploadPages(
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

  // 3b. Vision-quality raster — best effort.
  try {
    const visionPaths = await rasterizeAndUploadVisionPages(
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
    if (visionPaths.size > 0) {
      pageAssetRows = pageAssetRows.map((r) => ({
        ...r,
        vision_storage_path: visionPaths.get(r.page_index) ?? null,
      }));
    }
  } catch (err) {
    warnings.push(
      `Vision-quality pages skipped (display pages OK): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 4. Replace the manifest. Delete-then-insert is safer than upsert here
  // because the page_index assignment may differ from a previous attempt.
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

  // 5. Mark the review as pre-rasterized so the verify stage passes instantly.
  await supabase
    .from("plan_reviews")
    .update({
      ai_run_progress: { pre_rasterized: true, pre_rasterized_pages: pageAssetRows.length },
    })
    .eq("id", reviewId);

  // 6. Kick the pipeline back off at prepare_pages — verify stage will
  // confirm and advance to sheet_map.
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
