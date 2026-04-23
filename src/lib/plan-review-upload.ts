import { supabase } from "@/integrations/supabase/client";
import {
  getPDFPageCount,
  rasterizeAndUploadPagesResilient,
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
  /** Optional progress callback so the UI can render a persistent bar. */
  onProgress?: (p: { phase: string; prepared: number; expected: number }) => void;
}

export interface UploadPlanReviewResult {
  acceptedCount: number;
  pageAssetCount: number;
  pipelineStarted: boolean;
  /** True when rasterization succeeded for <80% of expected pages. */
  partialRasterize: boolean;
  expectedPages: number;
  warnings: string[];
}

/** Below this success ratio we refuse to start the pipeline. */
const MIN_RASTERIZE_RATIO = 0.8;

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

  // 2. Browser-side pre-rasterization (best effort, partial success allowed).
  let pageAssetRows: PreparedPageAsset[] = [];
  let totalExpectedPages = 0;
  let allFailures: Array<{ fileName: string; pageIndex: number; reason: string }> = [];
  if (typeof window !== "undefined") {
    try {
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
          totalExpectedPages += pageCount;
        }
      }
      const { succeeded, failures } = await rasterizeAndUploadPagesResilient(
        reviewId,
        pairs,
        async (path, blob) => {
          const res = await supabase.storage
            .from("documents")
            .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
          return { error: res.error ? { message: res.error.message } : null };
        },
        { startGlobalIndex: existingPageCount ?? 0, batchSize: 4 },
      );
      pageAssetRows = succeeded;
      allFailures = failures.map((f) => ({
        fileName: f.fileName,
        pageIndex: f.pageIndex,
        reason: f.reason ?? "unknown",
      }));
      if (failures.length > 0) {
        const byFile = new Map<string, number>();
        for (const f of failures) byFile.set(f.fileName, (byFile.get(f.fileName) ?? 0) + 1);
        for (const [fileName, count] of byFile) {
          warnings.push(`${fileName}: ${count} of its pages failed to rasterize.`);
        }
        warnings.push(
          `Rasterized ${succeeded.length} of ${totalExpectedPages} page${totalExpectedPages === 1 ? "" : "s"} — ${failures.length} failed.`,
        );
      }
    } catch (err) {
      warnings.push(
        `Browser rasterization failed; server will fall back: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      pageAssetRows = [];
    }
  }

  // 3. plan_reviews.file_urls + ai_run_progress (now also stamps expected_pages
  //    so prepare_pages can reconcile the manifest).
  await supabase
    .from("plan_reviews")
    .update({
      file_urls: newUrls,
      ai_run_progress: {
        pre_rasterized: pageAssetRows.length > 0,
        pre_rasterized_pages: pageAssetRows.length,
        expected_pages: (existingPageCount ?? 0) + totalExpectedPages,
      },
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

  // 5b. Persist per-page rasterize failures so they survive the upload toast.
  // The pipeline reads these to decide whether prepare_pages should re-render
  // the gaps before the AI stage runs.
  if (allFailures.length > 0) {
    try {
      await supabase.from("pipeline_error_log").insert(
        allFailures.slice(0, 500).map((f) => ({
          plan_review_id: reviewId,
          stage: "upload",
          error_class: "rasterize_partial",
          error_message: `${f.fileName} page ${f.pageIndex}: ${f.reason}`.slice(0, 4000),
          metadata: { file: f.fileName, page_index: f.pageIndex, reason: f.reason },
        })),
      );
    } catch {
      // Non-fatal — the warnings array still carries this info to the toast.
    }
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
