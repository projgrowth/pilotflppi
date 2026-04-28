/**
 * Soft-delete a project and cascade its plan reviews.
 *
 * Hard-blocked when any certificate of compliance has been issued — those are
 * legal records.
 */
import { supabase } from "@/integrations/supabase/client";
import { deletePlanReview } from "@/lib/delete-plan-review";

export interface DeleteProjectResult {
  reviewsDeleted: number;
  reviewsBlocked: number;
}

export async function deleteProject(
  projectId: string,
  userId: string,
  reason?: string,
): Promise<DeleteProjectResult> {
  // 0. Block on issued certificate of compliance.
  const { data: certs, error: certErr } = await supabase
    .from("certificates_of_compliance")
    .select("id")
    .eq("project_id", projectId)
    .is("revoked_at", null)
    .limit(1);
  if (certErr) throw certErr;
  if (certs && certs.length > 0) {
    throw new Error(
      "This project has an issued Certificate of Compliance — it can't be deleted. Revoke the certificate first if it was issued in error.",
    );
  }

  // 1. Cascade plan reviews. We allow individual reviews to fail (e.g. if a
  // letter was sent on one round) — the others still soft-delete.
  const { data: reviews } = await supabase
    .from("plan_reviews")
    .select("id")
    .eq("project_id", projectId)
    .is("deleted_at", null);

  let reviewsDeleted = 0;
  let reviewsBlocked = 0;
  for (const r of reviews ?? []) {
    try {
      await deletePlanReview(r.id, userId, reason);
      reviewsDeleted++;
    } catch {
      reviewsBlocked++;
    }
  }

  // 2. Soft-delete the project. If any reviews were blocked we still proceed
  // — the user explicitly typed the project name; respect that intent.
  const { error: projErr } = await supabase
    .from("projects")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: userId,
      delete_reason: reason ?? null,
    })
    .eq("id", projectId);
  if (projErr) throw projErr;

  await supabase.from("activity_log").insert({
    event_type: "project_deleted",
    description: `Project soft-deleted${reason ? ` — ${reason}` : ""}`,
    project_id: projectId,
    actor_id: userId,
    actor_type: "user",
    metadata: { reviews_deleted: reviewsDeleted, reviews_blocked: reviewsBlocked },
  });

  return { reviewsDeleted, reviewsBlocked };
}
