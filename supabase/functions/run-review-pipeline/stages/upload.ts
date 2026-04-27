// stages/upload.ts — verify uploaded files exist + are reachable in storage.
//
// This stage does NOT rasterize anything. Page rendering happens in the
// browser (pdf.js in `uploadPlanReviewFiles` / `reprepareInBrowser`); see
// `stages/prepare-pages.ts` for the verify-only follow-up.

import type { Admin } from "../_shared/supabase.ts";

export async function stageUpload(admin: Admin, planReviewId: string) {
  const { data, error } = await admin
    .from("plan_review_files")
    .select("id, file_path")
    .eq("plan_review_id", planReviewId);
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("No files uploaded for this plan review");
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
