/**
 * Soft-delete a plan review and all derived rows + storage objects.
 *
 * Soft = sets `deleted_at` on the parent rows so the UI hides them but the
 * data is recoverable for 30 days by an admin. Storage objects ARE
 * hard-deleted because we can't soft-delete bytes; the user gets one
 * warning about that in the confirm dialog.
 *
 * Cascade order:
 *   1. plan_review_files     — sets deleted_at, removes storage objects
 *   2. plan_review_page_assets — removes rendered page JPEGs
 *   3. deficiencies_v2       — sets status='waived', adds note
 *   4. review_pipeline_status — hard delete (transient state)
 *   5. plan_reviews          — sets deleted_at
 *
 * Hard-blocked when a comment_letter_snapshot has been sent (legal record).
 */
import { supabase } from "@/integrations/supabase/client";

export interface DeletePlanReviewResult {
  filesRemoved: number;
  pageAssetsRemoved: number;
  findingsArchived: number;
}

export async function deletePlanReview(
  planReviewId: string,
  userId: string,
  reason?: string,
): Promise<DeletePlanReviewResult> {
  // 0. Hard-block if any letter has been sent for this round.
  const { data: snapshots, error: snapErr } = await supabase
    .from("comment_letter_snapshots")
    .select("id, sent_at")
    .eq("plan_review_id", planReviewId)
    .not("sent_at", "is", null)
    .limit(1);
  if (snapErr) throw snapErr;
  if (snapshots && snapshots.length > 0) {
    throw new Error(
      "This review has a comment letter that was already sent — it's a legal record and cannot be deleted. Contact an admin to archive it instead.",
    );
  }

  // 1. List + remove plan_review_files storage objects.
  const { data: files, error: filesErr } = await supabase
    .from("plan_review_files")
    .select("id, file_path")
    .eq("plan_review_id", planReviewId)
    .is("deleted_at", null);
  if (filesErr) throw filesErr;
  const filePaths = (files ?? []).map((f) => f.file_path);
  if (filePaths.length > 0) {
    const { error: rmErr } = await supabase.storage.from("documents").remove(filePaths);
    if (rmErr) console.warn("[delete-plan-review] file remove failed", rmErr.message);
    await supabase
      .from("plan_review_files")
      .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
      .eq("plan_review_id", planReviewId);
  }

  // 2. Remove rendered page assets (storage + table). These are derived data.
  const pagePrefix = `plan-review-pages/${planReviewId}/`;
  let pageAssetsRemoved = 0;
  try {
    const { data: pageObjs } = await supabase.storage
      .from("documents")
      .list(`plan-review-pages/${planReviewId}`, { limit: 1000 });
    if (pageObjs && pageObjs.length > 0) {
      const paths = pageObjs.map((o) => `${pagePrefix}${o.name}`);
      await supabase.storage.from("documents").remove(paths);
      pageAssetsRemoved = paths.length;
    }
  } catch (err) {
    console.warn("[delete-plan-review] page asset cleanup failed", err);
  }
  await supabase.from("plan_review_page_assets").delete().eq("plan_review_id", planReviewId);

  // 3. Archive findings — soft-flag as waived so any FK references stay intact.
  const { count: findingCount } = await supabase
    .from("deficiencies_v2")
    .select("id", { count: "exact", head: true })
    .eq("plan_review_id", planReviewId);
  await supabase
    .from("deficiencies_v2")
    .update({ status: "waived", reviewer_notes: `[deleted ${new Date().toISOString()}] ${reason ?? ""}` })
    .eq("plan_review_id", planReviewId)
    .neq("status", "resolved");

  // 4. Hard-delete transient pipeline rows.
  await supabase.from("review_pipeline_status").delete().eq("plan_review_id", planReviewId);

  // 5. Soft-delete the plan_review itself.
  const { error: prErr } = await supabase
    .from("plan_reviews")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: userId,
      delete_reason: reason ?? null,
    })
    .eq("id", planReviewId);
  if (prErr) throw prErr;

  // 6. Activity log.
  await supabase.from("activity_log").insert({
    event_type: "plan_review_deleted",
    description: `Plan review soft-deleted${reason ? ` — ${reason}` : ""}`,
    actor_id: userId,
    actor_type: "user",
    metadata: { plan_review_id: planReviewId, files_removed: filePaths.length },
  });

  return {
    filesRemoved: filePaths.length,
    pageAssetsRemoved,
    findingsArchived: findingCount ?? 0,
  };
}

/**
 * Delete a single plan_review_file (and its storage object). Lighter-weight
 * than deletePlanReview — for when a user uploaded the wrong PDF.
 */
export async function deletePlanReviewFile(
  fileId: string,
  filePath: string,
  userId: string,
): Promise<void> {
  // Remove storage object first so a partial failure leaves an orphan row,
  // not an orphan blob (the cleanup cron handles orphan rows; orphan blobs are
  // invisible).
  const { error: rmErr } = await supabase.storage.from("documents").remove([filePath]);
  if (rmErr) console.warn("[delete-plan-review-file] storage remove failed", rmErr.message);

  const { error } = await supabase
    .from("plan_review_files")
    .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
    .eq("id", fileId);
  if (error) throw error;

  await supabase.from("activity_log").insert({
    event_type: "plan_review_file_deleted",
    description: `Plan file deleted: ${filePath.split("/").pop()}`,
    actor_id: userId,
    actor_type: "user",
    metadata: { file_id: fileId, file_path: filePath },
  });
}
