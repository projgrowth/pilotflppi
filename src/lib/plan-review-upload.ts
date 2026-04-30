import { supabase } from "@/integrations/supabase/client";
import {
  getPDFPageCount,
  rasterizeAndUploadPagesResilient,
  validatePDFHeader,
  type PreparedPageAsset,
} from "@/lib/pdf-utils";
import { startPipeline } from "@/lib/pipeline-run";
import { sha256OfFile } from "@/lib/file-hash";

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
  /**
   * Owning firm — REQUIRED. All storage objects are written under
   * `firms/<firmId>/plan-reviews/<reviewId>/...` to satisfy the firm-scoped
   * RLS policy on `storage.objects` and the CHECK constraint on
   * `plan_review_files.file_path`. Resolve via `useFirmId()` in the caller.
   */
  firmId: string;
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
  const { reviewId, firmId, round, existingFileUrls, existingPageCount, files, userId, onProgress } =
    args;
  const warnings: string[] = [];

  if (!firmId) {
    throw new Error("Cannot upload: missing firm context. Reload and try again.");
  }

  const prefix = `firms/${firmId}/plan-reviews/${reviewId}`;

  onProgress?.({ phase: "Validating PDFs…", prepared: 0, expected: 0 });

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

  // 1. Upload PDFs and capture SHA-256 fingerprints (Sprint 3 chain-of-custody).
  // We hash BEFORE upload so a corrupted bucket-side write would surface as a
  // hash-mismatch on the next download — the auditable contract is "this is
  // the byte sequence the contractor's browser produced".
  onProgress?.({ phase: "Uploading PDFs…", prepared: 0, expected: 0 });
  const newFilePaths: string[] = [];
  const fileHashes = new Map<string, { sha256: string; size: number }>();
  for (const file of acceptedFiles) {
    const path = `${prefix}/round-${round}/${file.name}`;
    let sha256: string | null = null;
    try {
      sha256 = await sha256OfFile(file);
    } catch (err) {
      warnings.push(
        `${file.name}: could not fingerprint (${err instanceof Error ? err.message : String(err)}); upload will continue without hash.`,
      );
    }
    const { error } = await supabase.storage
      .from("documents")
      .upload(path, file, { upsert: true, contentType: "application/pdf" });
    if (error) {
      warnings.push(`${file.name}: ${error.message}`);
      continue;
    }
    newFilePaths.push(path);
    if (sha256) fileHashes.set(path, { sha256, size: file.size });
  }
  if (newFilePaths.length === 0) {
    throw new Error(warnings.join("; ") || "All uploads failed.");
  }

  const newUrls = Array.from(new Set([...existingFileUrls, ...newFilePaths]));

  // 2. Browser-side pre-rasterization (best effort, partial success allowed).
  let pageAssetRows: PreparedPageAsset[] = [];
  let totalExpectedPages = 0;
  let allFailures: Array<{ fileName: string; pageIndex: number; reason: string }> = [];
  // Hoisted so step 5a can persist them after the manifest upsert succeeds.
  type PageTextRow = {
    plan_review_id: string;
    firm_id: string;
    page_index: number;
    items: { text: string; x: number; y: number; w: number; h: number }[];
    full_text: string;
    has_text_layer: boolean;
    char_count: number;
  };
  const textRows: PageTextRow[] = [];
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
      onProgress?.({
        phase: "Preparing pages in your browser…",
        prepared: 0,
        expected: totalExpectedPages,
      });
      // Persist extracted text incrementally so a partial rasterize still
      // gives the AI grounding signal for the pages it did get.
      const textRows: Array<{
        plan_review_id: string;
        firm_id: string;
        page_index: number;
        items: unknown;
        full_text: string;
        has_text_layer: boolean;
        char_count: number;
      }> = [];
      const { succeeded, failures } = await rasterizeAndUploadPagesResilient(
        reviewId,
        pairs,
        async (path, blob) => {
          const res = await supabase.storage
            .from("documents")
            .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
          return { error: res.error ? { message: res.error.message } : null };
        },
        {
          startGlobalIndex: existingPageCount ?? 0,
          batchSize: 4,
          pagesPrefix: `${prefix}/pages`,
          onPageText: (extraction) => {
            const fullText = extraction.fullText.slice(0, 200_000);
            textRows.push({
              plan_review_id: reviewId,
              firm_id: firmId,
              page_index: extraction.globalPageIndex,
              // Cap at 4000 items per page — 99th percentile sheet has < 2000.
              items: extraction.items.slice(0, 4000),
              full_text: fullText,
              has_text_layer: extraction.hasTextLayer,
              char_count: fullText.length,
            });
          },
        },
      );
      pageAssetRows = succeeded;
      allFailures = failures.map((f) => ({
        fileName: f.fileName,
        pageIndex: f.pageIndex,
        reason: f.reason ?? "unknown",
      }));
      onProgress?.({
        phase: "Finalizing…",
        prepared: succeeded.length,
        expected: totalExpectedPages,
      });
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

  // 4. plan_review_files audit rows — now stamped with SHA-256 + byte size
  // so a downstream verifier can confirm the bucket bytes still match.
  const { error: filesErr } = await supabase
    .from("plan_review_files")
    .insert(
      newFilePaths.map((fp) => {
        const h = fileHashes.get(fp);
        return {
          plan_review_id: reviewId,
          file_path: fp,
          round,
          uploaded_by: userId,
          pdf_sha256: h?.sha256 ?? null,
          file_size_bytes: h?.size ?? null,
        };
      }),
    );
  if (filesErr) warnings.push(`plan_review_files: ${filesErr.message}`);

  // 5. plan_review_page_assets manifest upsert.
  if (pageAssetRows.length > 0) {
    const { error: assetErr } = await supabase
      .from("plan_review_page_assets")
      .upsert(pageAssetRows, { onConflict: "plan_review_id,page_index" });
    if (assetErr) warnings.push(`page_assets: ${assetErr.message}`);
  }

  // 5a. plan_review_page_text upsert — vector text layer per page. Best effort:
  // a failure here doesn't block the pipeline, but the AI will fall back to
  // image-only reading on those pages.
  if (textRows.length > 0) {
    try {
      // Chunk to stay well under the request payload cap.
      for (let i = 0; i < textRows.length; i += 50) {
        const chunk = textRows.slice(i, i + 50);
        const { error: textErr } = await supabase
          .from("plan_review_page_text")
          .upsert(chunk, { onConflict: "plan_review_id,page_index" });
        if (textErr) {
          warnings.push(`page_text: ${textErr.message}`);
          break;
        }
      }
    } catch (err) {
      warnings.push(
        `page_text persist: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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

  // 6. Decide whether to start the pipeline. We refuse on a partial manifest
  // (<80% rasterized) — running on incomplete pages is the silent-failure
  // precursor we just spent rounds 1-6 cleaning up after. Caller surfaces a
  // "Prepare pages first" CTA via the partialRasterize flag.
  const successRatio =
    totalExpectedPages > 0 ? pageAssetRows.length / totalExpectedPages : 1;
  const partialRasterize =
    totalExpectedPages > 0 && successRatio < MIN_RASTERIZE_RATIO;

  let pipelineStarted = false;
  if (partialRasterize) {
    const reason = `Only ${pageAssetRows.length} of ${totalExpectedPages} pages prepared. Use "Prepare pages now" to retry the gaps before analyzing.`;
    warnings.push(`Pipeline NOT started — ${reason}`);
    // Persist the limbo state so a user who closes the tab and comes back
    // tomorrow sees the StuckRecoveryBanner CTA instead of an empty workspace.
    await supabase
      .from("plan_reviews")
      .update({
        ai_check_status: "needs_user_action",
        ai_run_progress: {
          pre_rasterized: pageAssetRows.length > 0,
          pre_rasterized_pages: pageAssetRows.length,
          expected_pages: (existingPageCount ?? 0) + totalExpectedPages,
          failure_reason: reason,
          needs_user_action_stage: "prepare_pages",
          needs_user_action_at: new Date().toISOString(),
        },
      })
      .eq("id", reviewId);
  } else {
    const pipeline = await startPipeline(reviewId, "core");
    if (!pipeline.ok) {
      warnings.push(`Pipeline did not start: ${pipeline.message}`);
    }
    pipelineStarted = pipeline.ok;
  }

  return {
    acceptedCount: newFilePaths.length,
    pageAssetCount: pageAssetRows.length,
    pipelineStarted,
    partialRasterize,
    expectedPages: totalExpectedPages,
    warnings,
  };
}
