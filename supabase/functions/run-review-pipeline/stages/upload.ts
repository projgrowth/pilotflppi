// stages/upload.ts — verify uploaded files exist + are reachable in storage.
//
// This stage does NOT rasterize anything. Page rendering happens in the
// browser (pdf.js in `uploadPlanReviewFiles` / `reprepareInBrowser`); see
// `stages/prepare-pages.ts` for the verify-only follow-up.

import type { Admin } from "../_shared/supabase.ts";

// Sentinel error class — the dispatcher in index.ts catches this by name and
// flips the review to `needs_user_action` immediately instead of waiting for
// the 15-min watchdog. Throwing a plain Error here would just trigger 3
// retries and a generic error log.
export class NoFilesUploadedError extends Error {
  constructor() {
    super(
      "No files have been uploaded for this plan review yet. Re-upload the PDF to continue.",
    );
    this.name = "NoFilesUploadedError";
  }
}

export async function stageUpload(admin: Admin, planReviewId: string) {
  const { data, error } = await admin
    .from("plan_review_files")
    .select("id, file_path")
    .eq("plan_review_id", planReviewId);
  if (error) throw error;
  if (!data || data.length === 0) {
    // Fast-fail: no point retrying — the user has to re-upload. The dispatcher
    // (index.ts) catches NoFilesUploadedError and flips ai_check_status to
    // 'needs_user_action' so StuckRecoveryBanner surfaces the CTA in seconds.
    throw new NoFilesUploadedError();
  }

  // Lightweight validation only — confirm files are reachable in storage.
  // Rasterization happens lazily inside signedSheetUrls() the first time a
  // downstream stage actually needs page images. This keeps the upload stage
  // well under the edge worker's CPU/memory budget for large plan sets.
  const sample = (data as Array<{ file_path: string }>)[0]?.file_path;
  if (sample) {
    const { data: signed, error: signErr } = await admin.storage
      .from("documents")
      .createSignedUrl(sample, 60);
    if (signErr || !signed) {
      throw new Error(
        `Cannot access uploaded file in storage: ${signErr?.message ?? "unknown"}`,
      );
    }
  }

  return { file_count: data.length };
}
