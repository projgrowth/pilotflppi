// Per-stage status writes that drive the dashboard stepper.
//
// FIX (2026-04-27): the old setStage() did SELECT-then-INSERT/UPDATE which
// raced the prepare_pages watchdog and the self-invoke worker — both could
// observe "no row" and both could insert, producing duplicate rows that broke
// the dashboard's "one row per (plan_review_id, stage)" assumption. Replaced
// with a single upsert on the unique constraint.

import type { Admin } from "./supabase.ts";
import type { Stage } from "./types.ts";

export async function setStage(
  admin: Admin,
  planReviewId: string,
  firmId: string | null,
  stage: Stage,
  patch: {
    status: "pending" | "running" | "complete" | "error";
    error_message?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    plan_review_id: planReviewId,
    firm_id: firmId,
    stage,
    status: patch.status,
    updated_at: now,
    error_message: patch.error_message ?? null,
    metadata: patch.metadata ?? {},
  };
  if (patch.status === "running") {
    payload.started_at = now;
    payload.heartbeat_at = now;
  }
  if (patch.status === "complete" || patch.status === "error") {
    payload.completed_at = now;
    payload.heartbeat_at = now;
  }

  // Single upsert keyed on the (plan_review_id, stage) unique index. If the
  // unique index doesn't exist yet, we fall back to the old read-then-write
  // path so a missing migration can't break production.
  const { error: upsertErr } = await admin
    .from("review_pipeline_status")
    .upsert(payload, { onConflict: "plan_review_id,stage" });

  if (upsertErr) {
    // Fallback: legacy schema without the unique index.
    const { data: existing } = await admin
      .from("review_pipeline_status")
      .select("id")
      .eq("plan_review_id", planReviewId)
      .eq("stage", stage)
      .maybeSingle();

    if (existing?.id) {
      await admin
        .from("review_pipeline_status")
        .update(payload)
        .eq("id", existing.id);
    } else {
      await admin.from("review_pipeline_status").insert(payload);
    }
  }
}

/**
 * Persist a structured row to public.pipeline_error_log so the dashboard
 * Errors tab + the per-review error stream both have something to show.
 * Best-effort — never throws (a failed insert can't be allowed to mask the
 * real stage error that triggered this call).
 */
// Severity buckets so the dashboard can separate real failures from cost
// telemetry / progress markers / advisory notes. Default mapping below; any
// caller can pass `severity` explicitly to override.
type Severity = "info" | "warn" | "error";

const SEVERITY_BY_CLASS: Record<string, Severity> = {
  cost_metric: "info",
  chunk_summary: "info",
  chunk_resume: "info",
  storage_cleanup: "info",
  rasterize_partial: "info",
  soft_timeout: "warn",
  stuck_no_progress: "warn",
  dispatch_failed: "warn",
  needs_browser_rasterization: "warn",
};

export async function recordPipelineError(
  admin: Admin,
  args: {
    planReviewId: string;
    firmId: string | null;
    stage: Stage;
    errorClass: string;
    errorMessage: string;
    attemptCount?: number;
    metadata?: Record<string, unknown>;
    severity?: Severity;
  },
): Promise<void> {
  const severity: Severity =
    args.severity ?? SEVERITY_BY_CLASS[args.errorClass] ?? "error";
  try {
    await admin.from("pipeline_error_log").insert({
      plan_review_id: args.planReviewId,
      firm_id: args.firmId,
      stage: args.stage,
      error_class: args.errorClass,
      error_message: (args.errorMessage ?? "").slice(0, 4000),
      attempt_count: args.attemptCount ?? 1,
      metadata: args.metadata ?? {},
      severity,
    });
  } catch (err) {
    console.error("[pipeline_error_log] insert failed:", err);
  }
}

/**
 * Lightweight heartbeat: bump only `heartbeat_at` for the active stage row.
 * Long-running stages (discipline_review chunked AI calls, ground_citations
 * batches) call this every chunk so the watchdog can distinguish a healthy
 * worker that's just slow from one that has actually died.
 *
 * Best-effort — never throws. A missed heartbeat is not a fatal condition;
 * the watchdog already tolerates a 15-min idle window.
 */
export async function heartbeat(
  admin: Admin,
  planReviewId: string,
  stage: Stage,
): Promise<void> {
  try {
    const now = new Date().toISOString();
    await admin
      .from("review_pipeline_status")
      .update({ heartbeat_at: now, updated_at: now })
      .eq("plan_review_id", planReviewId)
      .eq("stage", stage)
      .eq("status", "running");
  } catch (err) {
    console.warn("[heartbeat] failed:", err);
  }
}

/**
 * Atomically merge a JSON patch into plan_reviews.ai_run_progress.
 *
 * Replaces the old read-modify-write pattern that lost updates whenever two
 * stages wrote concurrently (e.g. a discipline_review chunk beacon racing a
 * submittal_check completion). Calls the public.merge_review_progress
 * Postgres function which does the merge in a single UPDATE statement.
 *
 * Best-effort — never throws. Progress writes are advisory; a missed one is
 * not worth aborting a stage over.
 */
export async function mergeProgress(
  admin: Admin,
  planReviewId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  try {
    const { error } = await admin.rpc("merge_review_progress", {
      _plan_review_id: planReviewId,
      _patch: patch,
    });
    if (error) console.warn("[mergeProgress] rpc failed:", error.message);
  } catch (err) {
    console.warn("[mergeProgress] threw:", err);
  }
}
