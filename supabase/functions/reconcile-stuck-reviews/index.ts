// Cron-triggered edge function that finds plan reviews wedged in
// `pending` / `running` for >15 min with no progress. For SERVER-recoverable
// stages it retries once then fails. For BROWSER-context stages (upload,
// prepare_pages) it flips to `needs_user_action` so the user knows to re-open
// the project — server retries can't help with browser-only work.
//
// Invoked by pg_cron every 5 min. Bounded to MAX_REVIEWS_PER_TICK so a flood
// of stuck rows doesn't blow our request budget.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const STUCK_MINUTES = 15;
const MAX_REVIEWS_PER_TICK = 25;
const MAX_AUTO_RECOVERIES = 1; // retry once, then fail

// Stages a server-side worker CAN actually re-run. The browser-context stages
// (upload, prepare_pages) need pdf.js running in the user's browser — a server
// kick does nothing useful and just burns the recovery slot.
const SERVER_RECOVERABLE_STAGES = new Set<string>([
  "dna_extract",
  "sheet_map",
  "discipline_review",
  "cross_check",
  "ground_citations",
  "verify",
  "letter_draft",
  "dedupe",
  "deferred_scope",
  "prioritize",
  "complete",
]);

const BROWSER_CONTEXT_STAGES = new Set<string>(["upload", "prepare_pages"]);

interface AdminLike {
  // deno-lint-ignore no-explicit-any
  from: (t: string) => any;
}

async function loadAdmin(): Promise<AdminLike> {
  const mod = await import("https://esm.sh/@supabase/supabase-js@2.74.0");
  return mod.createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) as AdminLike;
}

interface StuckRow {
  id: string;
  firm_id: string | null;
  ai_check_status: string;
  ai_run_progress: Record<string, unknown> | null;
  ai_run_mode: string | null;
  updated_at: string;
}

async function findLastStage(admin: AdminLike, planReviewId: string): Promise<{
  stage: string | null;
  heartbeatAt: string | null;
}> {
  const { data } = await admin
    .from("review_pipeline_status")
    .select("stage, status, updated_at, heartbeat_at")
    .eq("plan_review_id", planReviewId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = data as { stage?: string; heartbeat_at?: string | null } | null;
  return {
    stage: row?.stage ?? null,
    heartbeatAt: row?.heartbeat_at ?? null,
  };
}

async function logRecovery(admin: AdminLike, args: {
  planReviewId: string;
  firmId: string | null;
  lastStage: string | null;
  minutesIdle: number;
  recoveryCount: number;
  action: "retry" | "fail" | "needs_user_action";
  reason: string;
}) {
  try {
    await admin.from("pipeline_error_log").insert({
      plan_review_id: args.planReviewId,
      firm_id: args.firmId,
      stage: "dispatch",
      error_class: "stuck_no_progress",
      error_message: args.reason.slice(0, 4000),
      attempt_count: args.recoveryCount,
      metadata: {
        last_stage: args.lastStage,
        minutes_idle: args.minutesIdle,
        action: args.action,
        recovery_count: args.recoveryCount,
      },
    });
  } catch (err) {
    console.error("[reconcile] failed to log recovery:", err);
  }
}

async function startPipeline(planReviewId: string, mode: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/run-review-pipeline`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "x-internal-self-invoke": "1",
      },
      body: JSON.stringify({
        plan_review_id: planReviewId,
        // Persisted mode wins so a deep run isn't silently downgraded.
        mode: mode === "deep" || mode === "full" ? mode : "core",
        _internal: true,
      }),
    });
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

async function reconcileOne(admin: AdminLike, row: StuckRow, nowMs: number) {
  const idleMs = nowMs - new Date(row.updated_at).getTime();
  const minutesIdle = Math.round(idleMs / 60000);
  const { stage: lastStage, heartbeatAt } = await findLastStage(admin, row.id);

  // HEARTBEAT BYPASS: if the active stage emitted a heartbeat in the last
  // 5 minutes, it's still alive (likely a long AI chunk). Don't reset it
  // just because plan_reviews.updated_at is older than 15 min.
  if (heartbeatAt) {
    const heartbeatAgeMs = nowMs - new Date(heartbeatAt).getTime();
    if (heartbeatAgeMs < 5 * 60 * 1000) {
      return { id: row.id, action: "alive" as const, lastStage, minutesIdle: Math.round(heartbeatAgeMs / 60000) };
    }
  }

  const progress = row.ai_run_progress ?? {};
  const recoveryCount =
    typeof (progress as Record<string, unknown>).auto_recovery_count === "number"
      ? ((progress as Record<string, number>).auto_recovery_count as number)
      : 0;

  // BROWSER-CONTEXT STAGE: server can't help. Park for the user.
  if (lastStage && BROWSER_CONTEXT_STAGES.has(lastStage)) {
    const reason =
      lastStage === "upload"
        ? "Upload incomplete — please re-open the project to finish uploading the plan files."
        : "Page preparation incomplete — please re-open the project to finish rendering pages in your browser.";
    await admin
      .from("plan_reviews")
      .update({
        ai_check_status: "needs_user_action",
        ai_run_progress: {
          ...(progress as Record<string, unknown>),
          failure_reason: reason,
          needs_user_action_stage: lastStage,
          needs_user_action_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    await logRecovery(admin, {
      planReviewId: row.id,
      firmId: row.firm_id,
      lastStage,
      minutesIdle,
      recoveryCount,
      action: "needs_user_action",
      reason: `Stuck at browser-context stage '${lastStage}' for ${minutesIdle} min — parked for user action.`,
    });
    return { id: row.id, action: "needs_user_action" as const, lastStage, minutesIdle };
  }

  // SERVER-RECOVERABLE: only retry these.
  if (lastStage && !SERVER_RECOVERABLE_STAGES.has(lastStage)) {
    // Unknown stage — fail it cleanly, don't waste a retry.
    const failureReason = `Stuck at unknown stage '${lastStage}' for ${minutesIdle} min — cannot auto-recover.`;
    await admin
      .from("plan_reviews")
      .update({
        ai_check_status: "failed",
        ai_run_progress: {
          ...(progress as Record<string, unknown>),
          failure_reason: failureReason,
          failed_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    await logRecovery(admin, {
      planReviewId: row.id,
      firmId: row.firm_id,
      lastStage,
      minutesIdle,
      recoveryCount,
      action: "fail",
      reason: failureReason,
    });
    return { id: row.id, action: "fail" as const, lastStage, minutesIdle };
  }

  if (recoveryCount >= MAX_AUTO_RECOVERIES) {
    // Already retried — fail it cleanly so the dashboard shows it.
    const failureReason = `Stuck at ${lastStage ?? "(unknown stage)"} for ${minutesIdle} min, after ${recoveryCount} retry attempt(s).`;
    await admin
      .from("plan_reviews")
      .update({
        ai_check_status: "failed",
        ai_run_progress: {
          ...(progress as Record<string, unknown>),
          failure_reason: failureReason,
          failed_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    await logRecovery(admin, {
      planReviewId: row.id,
      firmId: row.firm_id,
      lastStage,
      minutesIdle,
      recoveryCount,
      action: "fail",
      reason: failureReason,
    });
    return { id: row.id, action: "fail" as const, lastStage, minutesIdle };
  }

  // First strike: clear cancellation, bump retry counter, kick the pipeline.
  const nextProgress: Record<string, unknown> = {
    ...(progress as Record<string, unknown>),
    auto_recovery_count: recoveryCount + 1,
    auto_recovered_at: new Date().toISOString(),
    auto_recovered_from_stage: lastStage,
  };
  // Clear the cancellation flag so the new worker doesn't immediately halt.
  if ("cancelled_at" in nextProgress) delete (nextProgress as Record<string, unknown>).cancelled_at;

  await admin
    .from("plan_reviews")
    .update({
      ai_check_status: "pending",
      ai_run_progress: nextProgress,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  const kick = await startPipeline(row.id, row.ai_run_mode ?? "core");
  await logRecovery(admin, {
    planReviewId: row.id,
    firmId: row.firm_id,
    lastStage,
    minutesIdle,
    recoveryCount: recoveryCount + 1,
    action: "retry",
    reason:
      `Stuck at ${lastStage ?? "(unknown stage)"} for ${minutesIdle} min — auto-retry ${recoveryCount + 1}/${MAX_AUTO_RECOVERIES}.` +
      (kick.ok ? "" : ` Kick failed: ${kick.message}`),
  });
  return { id: row.id, action: "retry" as const, lastStage, minutesIdle, kicked: kick.ok };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const admin = await loadAdmin();
    const cutoff = new Date(Date.now() - STUCK_MINUTES * 60 * 1000).toISOString();

    // Reviews that LOOK active but haven't moved in 15+ min.
    const { data: stuck, error } = await admin
      .from("plan_reviews")
      .select("id, firm_id, ai_check_status, ai_run_progress, ai_run_mode, updated_at")
      .in("ai_check_status", ["pending", "running"])
      .lt("updated_at", cutoff)
      .order("updated_at", { ascending: true })
      .limit(MAX_REVIEWS_PER_TICK);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rows = (stuck ?? []) as StuckRow[];
    const nowMs = Date.now();
    const results = [];
    for (const row of rows) {
      try {
        results.push(await reconcileOne(admin, row, nowMs));
      } catch (err) {
        console.error(`[reconcile] failed for ${row.id}:`, err);
        results.push({
          id: row.id,
          action: "error" as const,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, scanned: rows.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[reconcile-stuck-reviews] fatal:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
