/**
 * Single source of truth for "where should opening this review take the user?".
 *
 * - In-flight runs (status pending/running, or any active pipeline row) → the
 *   /dashboard surface, which owns the live stepper + ETA + cancel.
 * - Anything that needs the user to do something or is finished/idle → the
 *   workspace, which is built for reviewing findings against the PDF.
 *
 * Centralizing this prevents the "I clicked Review and landed on a blank
 * 'Run AI Check' button mid-pipeline" UX regression from creeping back in.
 */

export type ReviewRouteStatus =
  | "pending"
  | "running"
  | "needs_user_action"
  | "needs_human_review"
  | "complete"
  | "error"
  | string
  | null
  | undefined;

export interface ReviewRouteContext {
  /** plan_reviews.ai_check_status */
  aiCheckStatus?: ReviewRouteStatus;
  /** True when at least one pipeline_status row is pending/running. */
  pipelineActive?: boolean;
}

/**
 * Returns the path the user should open for a given review.
 *
 * Default: workspace. Pivots to /dashboard only when the review is clearly
 * mid-run, blocked, or just kicked off and findings can't be reviewed yet.
 */
export function routeForReview(
  reviewId: string,
  ctx: ReviewRouteContext = {},
): string {
  const status = ctx.aiCheckStatus ?? null;
  const inFlight =
    ctx.pipelineActive === true ||
    status === "pending" ||
    status === "running" ||
    status === "needs_user_action" ||
    status === "needs_human_review";

  return inFlight
    ? `/plan-review/${reviewId}/dashboard`
    : `/plan-review/${reviewId}`;
}
