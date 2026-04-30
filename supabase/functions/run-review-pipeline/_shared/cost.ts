// Lightweight per-request context so callAI() can attribute every Lovable AI
// call back to a stage / discipline / chunk without us having to thread args
// through 35 callsites. The Deno.serve handler sets this once per request and
// individual stages can refine it via withCostCtx() before calling callAI().
//
// CRITICAL: This module-level mutable singleton MUST live in exactly one
// module. If two stage files each imported a local copy, withCostCtx() in
// one would not be visible to callAI() in the other, and every cost row
// would be attributed to "unknown".

import type { Admin } from "./supabase.ts";

export type CostCtx = {
  admin: Admin | null;
  planReviewId: string | null;
  firmId: string | null;
  stage: string | null;
  discipline: string | null;
  chunk: string | null;
};

let CURRENT_COST_CTX: CostCtx = {
  admin: null,
  planReviewId: null,
  firmId: null,
  stage: null,
  discipline: null,
  chunk: null,
};

/** Replace the entire context. Used once at the top of the request handler. */
export function setCostCtx(ctx: CostCtx): void {
  CURRENT_COST_CTX = ctx;
}

/** Read the current context (mainly for tests / debugging). */
export function getCostCtx(): CostCtx {
  return CURRENT_COST_CTX;
}

/** Push a refined context for the duration of `fn`, then restore. */
export async function withCostCtx<T>(
  patch: Partial<Pick<CostCtx, "stage" | "discipline" | "chunk">>,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = CURRENT_COST_CTX;
  CURRENT_COST_CTX = { ...prev, ...patch };
  try {
    return await fn();
  } finally {
    CURRENT_COST_CTX = prev;
  }
}

// Cost telemetry is opt-in via the COST_METRIC_LOGGING env var. By default
// we DO NOT write cost rows into pipeline_error_log — they crowd the error
// table (~280 rows in 14 days for one project) and make real failures hard
// to spot. Set COST_METRIC_LOGGING=1 in the function env to re-enable.
const COST_METRIC_LOGGING_ENABLED = Deno.env.get("COST_METRIC_LOGGING") === "1";

export async function recordCostMetric(metadata: Record<string, unknown>): Promise<void> {
  if (!COST_METRIC_LOGGING_ENABLED) return;
  const ctx = CURRENT_COST_CTX;
  if (!ctx.admin || !ctx.planReviewId) return;
  try {
    await ctx.admin.from("pipeline_error_log").insert({
      plan_review_id: ctx.planReviewId,
      firm_id: ctx.firmId,
      stage: ctx.stage ?? "unknown",
      error_class: "cost_metric",
      error_message: "",
      attempt_count: 1,
      // Cost rows are telemetry, not errors — `severity` keeps the Errors
      // tab and Analytics trend chart from drowning in green-path noise.
      severity: "info",
      metadata: {
        discipline: ctx.discipline,
        chunk: ctx.chunk,
        ...metadata,
      },
    });
  } catch (err) {
    // Best-effort — never let telemetry mask a real error.
    console.warn("[cost_metric] insert failed:", err instanceof Error ? err.message : String(err));
  }
}
