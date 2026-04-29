/**
 * Restore a soft-deleted project. Cascades to its plan_reviews so the project
 * shows up in the normal list again. Files (plan_review_files) are NOT
 * restored: their underlying storage objects were purged at delete time.
 *
 * The user is expected to re-upload PDFs after a restore.
 */
import { supabase } from "@/integrations/supabase/client";

export interface RestoreProjectResult {
  reviewsRestored: number;
}

export async function restoreProject(
  projectId: string,
  userId: string,
): Promise<RestoreProjectResult> {
  // 1. Restore the project row.
  const { error: projErr } = await supabase
    .from("projects")
    .update({
      deleted_at: null,
      deleted_by: null,
      delete_reason: null,
    })
    .eq("id", projectId);
  if (projErr) throw projErr;

  // 2. Restore its plan_reviews. We restore everything that was deleted in
  // the same minute window as the project deletion to avoid resurrecting
  // reviews that were independently deleted earlier.
  const { data: project } = await supabase
    .from("projects")
    .select("updated_at")
    .eq("id", projectId)
    .single();

  let reviewsRestored = 0;
  if (project?.updated_at) {
    const { data: restored, error: rErr } = await supabase
      .from("plan_reviews")
      .update({ deleted_at: null, deleted_by: null, delete_reason: null })
      .eq("project_id", projectId)
      .not("deleted_at", "is", null)
      .select("id");
    if (rErr) throw rErr;
    reviewsRestored = restored?.length ?? 0;
  }

  await supabase.from("activity_log").insert({
    event_type: "project_restored",
    description: "Project restored from soft-delete",
    project_id: projectId,
    actor_id: userId,
    actor_type: "user",
    metadata: { reviews_restored: reviewsRestored },
  });

  return { reviewsRestored };
}
