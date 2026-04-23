import { supabase } from "@/integrations/supabase/client";
import {
  getPDFPageCount,
  rasterizeAndUploadPages,
  validatePDFHeader,
  type PreparedPageAsset,
} from "@/lib/pdf-utils";
import { startPipeline } from "@/lib/pipeline-run";

/**
 * Upload plan-review files end-to-end:
 *
 *   1. Validates files are PDFs.
 *   2. Uploads each PDF to the `documents` bucket under
 *      `plan-reviews/<reviewId>/round-<n>/<filename>`.
 *   3. Pre-rasterizes pages in the browser (fast path — keeps the edge
 *      function's `prepare_pages` stage as a near no-op).
 *   4. Updates `plan_reviews.file_urls`, inserts `plan_review_files` rows,
 *      upserts `plan_review_page_assets` rows.
 *   5. Kicks off `run-review-pipeline` so the new files get analyzed.
 *
 * Each step is best-effort with structured warnings so the page can show a
 * single accurate toast instead of swallowing failures.
 */

export interface UploadPlanReviewArgs {
  reviewId: string;
  round: number;
  existingFileUrls: string[];
  existingPageCount: number | null;
  files: File[];
  userId: string | null;
}

export interface UploadPlanReviewResult {
  acceptedCount: number;
  pageAssetCount: number;
  pipelineStarted: boolean;
  warnings: string[];
}

export async function uploadPlanReviewFiles(
  args: UploadPlanReviewArgs,
): Promise<UploadPlanReviewResult> {
  const { reviewId, round, existingFileUrls, existingPageCount, files, userId } =
    args;
  const warnings: string[] = [];

  const acceptedFiles: File[] = [];
  for (const f of files) {
    if (f.type !== "application/pdf") {
      warnings.push(`${f.name}: only PDF files are supported.`);
      continue;
    }
    // Validate magic bytes BEFORE upload — server can no longer rasterize, so
    // a corrupt PDF that slips through means the review is dead-on-arrival.
    const isPdf = await validatePDFHeader(f);
    if (!isPdf) {
      warnings.push(`${f.name}: file is not a valid PDF (bad header).`);
      continue;
    }
    acceptedFiles.push(f);
  }
  if (acceptedFiles.length === 0) {
    throw new Error(warnings.join("; ") || "No valid PDF files to upload.");
  }

  // 1. Upload PDFs.
  const newFilePaths: string[] = [];
  for (const file of acceptedFiles) {
    const path = `plan-reviews/${reviewId}/round-${round}/${file.name}`;
    const { error } = await supabase.storage
      .from("documents")
      .upload(path, file, { upsert: true, contentType: "application/pdf" });
    if (error) {
      warnings.push(`${file.name}: ${error.message}`);
      continue;
    }
    newFilePaths.push(path);
  }
  if (newFilePaths.length === 0) {
    throw new Error(warnings.join("; ") || "All uploads failed.");
  }

  const newUrls = Array.from(new Set([...existingFileUrls, ...newFilePaths]));

  // 2. Browser-side pre-rasterization (best effort).
  let pageAssetRows: PreparedPageAsset[] = [];
  if (typeof window !== "undefined") {
    try {
      // Pair each accepted File with its uploaded path + page count for the
      // shape rasterizeAndUploadPages expects.
      const pairs: Array<{
        name: string;
        file: File;
        storagePath: string;
        pageCount: number;
      }> = [];
      for (let i = 0; i < acceptedFiles.length; i++) {
        const file = acceptedFiles[i];
        const storagePath = newFilePaths.find((p) => p.endsWith(`/${file.name}`));
        if (!storagePath) continue;
        let pageCount = 0;
        try {
          pageCount = await getPDFPageCount(file);
        } catch {
          continue;
        }
        if (pageCount > 0) {
          pairs.push({ name: file.name, file, storagePath, pageCount });
        }
      }
      pageAssetRows = await rasterizeAndUploadPages(
        reviewId,
        pairs,
        async (path, blob) => {
          const res = await supabase.storage
            .from("documents")
            .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
          return { error: res.error ? { message: res.error.message } : null };
        },
        { startGlobalIndex: existingPageCount ?? 0 },
      );
    } catch (err) {
      warnings.push(
        `Browser rasterization failed; server will fall back: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      pageAssetRows = [];
    }
  }

  // 3. plan_reviews.file_urls + ai_run_progress.
  await supabase
    .from("plan_reviews")
    .update({
      file_urls: newUrls,
      ai_run_progress:
        pageAssetRows.length > 0
          ? { pre_rasterized: true, pre_rasterized_pages: pageAssetRows.length }
          : undefined,
    })
    .eq("id", reviewId);

  // 4. plan_review_files audit rows.
  const { error: filesErr } = await supabase
    .from("plan_review_files")
    .insert(
      newFilePaths.map((fp) => ({
        plan_review_id: reviewId,
        file_path: fp,
        round,
        uploaded_by: userId,
      })),
    );
  if (filesErr) warnings.push(`plan_review_files: ${filesErr.message}`);

  // 5. plan_review_page_assets manifest upsert.
  if (pageAssetRows.length > 0) {
    const { error: assetErr } = await supabase
      .from("plan_review_page_assets")
      .upsert(pageAssetRows, { onConflict: "plan_review_id,page_index" });
    if (assetErr) warnings.push(`page_assets: ${assetErr.message}`);
  }

  // 6. Kick off the pipeline. This is the step previously swallowed by a
  // console.warn — surface it now so the user knows when nothing started.
  const pipeline = await startPipeline(reviewId, "core");
  if (!pipeline.ok) {
    warnings.push(`Pipeline did not start: ${pipeline.message}`);
  }
  const pipelineStarted = pipeline.ok;

  return {
    acceptedCount: newFilePaths.length,
    pageAssetCount: pageAssetRows.length,
    pipelineStarted,
    warnings,
  };
}
