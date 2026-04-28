/**
 * Per-file delete for a plan review. Soft-deletes the matching
 * `plan_review_files` row, removes the storage object, and rewrites
 * `plan_reviews.file_urls` so the viewer no longer references it.
 *
 * Hard-blocks if a comment letter has already been sent for this round —
 * the source file is part of the legal record at that point.
 */
import { supabase } from "@/integrations/supabase/client";

export interface DeleteFileArgs {
  planReviewId: string;
  filePath: string; // storage path (the entry in file_urls / plan_review_files.file_path)
  reason?: string;
}

export interface DeleteFileResult {
  ok: boolean;
  blocker?: string;
}

export async function deletePlanReviewFile(
  args: DeleteFileArgs,
): Promise<DeleteFileResult> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return { ok: false, blocker: "Not signed in" };

  // 1. Hard-block if a letter snapshot already exists for this review.
  const { count: snapCount } = await supabase
    .from("comment_letter_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("plan_review_id", args.planReviewId);
  if ((snapCount ?? 0) > 0) {
    return {
      ok: false,
      blocker:
        "A comment letter has already been sent for this review. The source file is part of the legal record and can't be deleted.",
    };
  }

  // 2. Pull current file_urls.
  const { data: review, error: revErr } = await supabase
    .from("plan_reviews")
    .select("file_urls")
    .eq("id", args.planReviewId)
    .maybeSingle();
  if (revErr || !review) return { ok: false, blocker: revErr?.message ?? "Review not found" };

  const urls: string[] = (review.file_urls ?? []) as string[];
  const nextUrls = urls.filter((u) => u !== args.filePath);

  // 3. Soft-delete plan_review_files row(s) matching this path.
  await supabase
    .from("plan_review_files")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: userId,
    })
    .eq("plan_review_id", args.planReviewId)
    .eq("file_path", args.filePath)
    .is("deleted_at", null);

  // 4. Remove from storage (best-effort).
  await supabase.storage.from("documents").remove([args.filePath]);

  // 5. Rewrite plan_reviews.file_urls.
  const { error: updErr } = await supabase
    .from("plan_reviews")
    .update({ file_urls: nextUrls })
    .eq("id", args.planReviewId);
  if (updErr) return { ok: false, blocker: updErr.message };

  // 6. Activity log.
  await supabase.from("activity_log").insert({
    event_type: "plan_review_file_deleted",
    description: `Plan review file removed: ${args.filePath.split("/").pop()}`,
    actor_id: userId,
    actor_type: "user",
    metadata: { plan_review_id: args.planReviewId, file_path: args.filePath, reason: args.reason ?? null },
  });

  return { ok: true };
}
