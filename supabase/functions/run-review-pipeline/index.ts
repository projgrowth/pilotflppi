// Edge function: orchestrates the multi-stage plan review pipeline.
//
// Phase A (2026-04-27): leaf utilities → `_shared/*`.
// Phase B (2026-04-27): intake + DNA stages → `stages/*`.
// Phase C (2026-04-27): heavy review stages → `stages/*`. This file is now a
// thin dispatcher: parse → authenticate → seed pending rows → run one stage
// → schedule next. All real work lives in stage modules.
//
// The `CURRENT_COST_CTX` mutable singleton lives ONLY in `_shared/cost.ts` —
// importing two copies would silently break cost attribution.

import {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY,
  corsHeaders,
} from "./_shared/env.ts";
import { createClient } from "./_shared/supabase.ts";
import {
  type Stage,
  type PipelineMode,
  STAGES,
  stagesForMode,
  NEEDS_BROWSER_RASTERIZATION,
} from "./_shared/types.ts";
import { setStage, recordPipelineError, mergeProgress } from "./_shared/pipeline-status.ts";
import { withRetry } from "./_shared/retry.ts";
import { setCostCtx, withCostCtx } from "./_shared/cost.ts";
import { scheduleNextStage } from "./_shared/dispatcher.ts";

import { stageUpload } from "./stages/upload.ts";
import { stagePreparePages } from "./stages/prepare-pages.ts";
import { stageSheetMap } from "./stages/sheet-map.ts";
import { stageSubmittalCheck } from "./stages/submittal-check.ts";
import { stageCalloutGraph } from "./stages/callout-graph.ts";
import {
  stageDnaExtract,
  stageDnaReevaluate,
  type DnaHealth,
} from "./stages/dna.ts";
import { stageDisciplineReview } from "./stages/discipline-review.ts";
import { stageCritic } from "./stages/critic.ts";
import { stageVerify } from "./stages/verify.ts";
import { stageDedupe } from "./stages/dedupe.ts";
import { stageGroundCitations } from "./stages/ground-citations.ts";
import { stageChallenger } from "./stages/challenger.ts";
import { stageCrossCheck } from "./stages/cross-check.ts";
import { stageDeferredScope } from "./stages/deferred-scope.ts";
import { stagePrioritize } from "./stages/prioritize.ts";
import { stageComplete } from "./stages/complete.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const plan_review_id = body?.plan_review_id;
    const requestedStage: Stage | undefined = body?.stage;
    const startFrom: Stage | undefined = body?.start_from;
    const rawMode = typeof body?.mode === "string" ? body.mode : "core";
    const mode: PipelineMode =
      rawMode === "deep" || rawMode === "full" ? rawMode : "core";
    // effectiveChain is built later (after persisted mode lookup) so a
    // recovery worker doesn't downgrade a "deep" run to "core".
    void body?.target_source; // legacy field, ignored
    const isInternalSelfInvoke =
      body?._internal === true || req.headers.get("x-internal-self-invoke") === "1";

    if (!plan_review_id || typeof plan_review_id !== "string") {
      return new Response(JSON.stringify({ error: "plan_review_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authenticate. Internal self-invokes use the service role key as a
    // bearer token, which getClaims() rejects — accept that case based on the
    // marker header + matching service role secret.
    if (!isInternalSelfInvoke) {
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const token = authHeader.replace("Bearer ", "");
      const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
      if (claimsErr || !claimsData?.claims) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      const expected = `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
      if (authHeader !== expected) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: pr, error: prErr } = await admin
      .from("plan_reviews")
      .select("id, firm_id, ai_run_mode")
      .eq("id", plan_review_id)
      .maybeSingle();
    if (prErr || !pr) {
      return new Response(JSON.stringify({ error: "plan_review not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const firmId = (pr as { firm_id: string | null }).firm_id;
    const persistedMode = (pr as { ai_run_mode?: string | null }).ai_run_mode;

    // Internal self-invokes from the dispatcher always pass an explicit
    // mode. But watchdog-triggered recoveries default to "core" — which
    // would silently downgrade a "deep" run mid-chain. Prefer the persisted
    // mode whenever the caller didn't explicitly specify one (we only get
    // an explicit mode from the original user click or the dispatcher).
    const effectiveMode: PipelineMode =
      persistedMode === "deep" || persistedMode === "full"
        ? (persistedMode as PipelineMode)
        : mode;
    const effectiveChain = stagesForMode(effectiveMode);

    // First-touch: persist the mode the user originally chose so a future
    // recovery worker can rebuild the same chain.
    if (!persistedMode) {
      await admin
        .from("plan_reviews")
        .update({ ai_run_mode: mode })
        .eq("id", plan_review_id);
    }

    setCostCtx({
      admin,
      planReviewId: plan_review_id,
      firmId,
      stage: requestedStage ?? null,
      discipline: null,
      chunk: null,
    });

    // Resolve which single stage this invocation runs.
    let stageToRun: Stage;
    if (requestedStage) {
      stageToRun = requestedStage;
      await setStage(admin, plan_review_id, firmId, stageToRun, { status: "pending" });
    } else if (startFrom) {
      stageToRun = startFrom;
      const idx = STAGES.indexOf(startFrom);
      const tail = idx >= 0 ? STAGES.slice(idx) : STAGES;
      for (const s of tail) {
        await setStage(admin, plan_review_id, firmId, s, { status: "pending" });
      }
    } else {
      // H-04: Concurrency guard — fresh runs only. If a live run already
      // exists on this plan_review_id (a stage marked running with a
      // recent heartbeat), reject instead of double-billing AI tokens.
      // Stale runs (heartbeat > 2 min old) are reaped by the watchdog and
      // will not block a new attempt.
      const HEARTBEAT_FRESH_MS = 2 * 60 * 1000;
      const cutoffIso = new Date(Date.now() - HEARTBEAT_FRESH_MS).toISOString();
      const { data: liveStages } = await admin
        .from("review_pipeline_status")
        .select("stage, heartbeat_at, updated_at")
        .eq("plan_review_id", plan_review_id)
        .eq("status", "running")
        .gte("heartbeat_at", cutoffIso);
      if (liveStages && liveStages.length > 0) {
        const stages = (liveStages as Array<{ stage: string }>).map((s) => s.stage).join(", ");
        return new Response(
          JSON.stringify({
            error: "pipeline_already_running",
            message: `A pipeline run is already in progress for this review (stages: ${stages}). Cancel it first or wait for it to finish.`,
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      stageToRun = effectiveChain[0];
      for (const s of effectiveChain) {
        await setStage(admin, plan_review_id, firmId, s, { status: "pending" });
      }
    }

    const stageImpls: Record<Stage, () => Promise<Record<string, unknown>>> = {
      upload: () => stageUpload(admin, plan_review_id),
      prepare_pages: () => stagePreparePages(admin, plan_review_id, firmId),
      sheet_map: () => stageSheetMap(admin, plan_review_id, firmId),
      submittal_check: () => stageSubmittalCheck(admin, plan_review_id, firmId),
      callout_graph: () => stageCalloutGraph(admin, plan_review_id, firmId),
      dna_extract: () =>
        startFrom && STAGES.indexOf(startFrom) > 0 && stageToRun === "dna_extract"
          ? stageDnaReevaluate(admin, plan_review_id)
          : stageDnaExtract(admin, plan_review_id, firmId),
      discipline_review: () => stageDisciplineReview(admin, plan_review_id, firmId),
      critic: () => stageCritic(admin, plan_review_id),
      verify: () => stageVerify(admin, plan_review_id),
      dedupe: () => stageDedupe(admin, plan_review_id),
      ground_citations: () => stageGroundCitations(admin, plan_review_id),
      challenger: () => stageChallenger(admin, plan_review_id),
      cross_check: () => stageCrossCheck(admin, plan_review_id, firmId),
      deferred_scope: () => stageDeferredScope(admin, plan_review_id, firmId),
      prioritize: () => stagePrioritize(admin, plan_review_id),
      complete: () => stageComplete(admin, plan_review_id),
    };

    const isCancelled = async (): Promise<boolean> => {
      const { data } = await admin
        .from("plan_reviews")
        .select("ai_run_progress")
        .eq("id", plan_review_id)
        .maybeSingle();
      const progress =
        (data as { ai_run_progress?: Record<string, unknown> | null } | null)
          ?.ai_run_progress ?? {};
      return typeof progress.cancelled_at === "string" && progress.cancelled_at.length > 0;
    };

    const runOneStage = async () => {
      if (await isCancelled()) {
        // Cancelled runs used to be marked `error` with message "Cancelled by
        // user" — that polluted the Errors tab and the Analytics failure-rate
        // chart. Mark them with a metadata flag instead so dashboards can
        // bucket them separately.
        await setStage(admin, plan_review_id, firmId, stageToRun, {
          status: "error",
          error_message: "Cancelled by user",
          metadata: { cancelled: true, error_class: "cancelled" },
        });
        return;
      }

      await setStage(admin, plan_review_id, firmId, stageToRun, { status: "running" });
      try {
        const meta = await withCostCtx({ stage: stageToRun }, () =>
          withRetry(() => stageImpls[stageToRun](), `stage:${stageToRun}`),
        );

        await setStage(admin, plan_review_id, firmId, stageToRun, {
          status: "complete",
          metadata: meta,
        });

        // DNA gate: a blocking DNA result halts the pipeline.
        if (stageToRun === "dna_extract") {
          const m = meta as Partial<DnaHealth>;
          if (m.blocking) {
            await setStage(admin, plan_review_id, firmId, stageToRun, {
              status: "error",
              error_message: `DNA gate: ${m.block_reason ?? "extraction blocked"}`,
              metadata: meta as Record<string, unknown>,
            });
            return;
          }
        }

        // Submittal gate: when the firm has opted into hard-blocking,
        // an incomplete submittal halts the chain so we don't burn AI
        // spend (and reviewer trust) on a partial set. Default firm
        // setting is OFF so existing flows keep their advisory behavior.
        if (stageToRun === "submittal_check") {
          const m = meta as { complete?: boolean; missing?: string[] };
          if (m.complete === false) {
            // Multi-tenant safety (A-03): always scope firm_settings to the
            // current firm. Prefer firm_id (tenant key); fall back to user_id
            // (firm owner) for legacy rows. NEVER query without a firm filter
            // or another tenant's settings could leak in.
            let block = false;
            if (firmId) {
              const { data: members } = await admin
                .from("firm_members")
                .select("user_id")
                .eq("firm_id", firmId)
                .order("created_at", { ascending: true })
                .limit(1);
              const ownerUserId = (members?.[0] as { user_id?: string } | undefined)?.user_id;

              const { data: byFirm } = await admin
                .from("firm_settings")
                .select("block_review_on_incomplete_submittal")
                .eq("firm_id", firmId)
                .maybeSingle();
              if (byFirm) {
                block = (byFirm as { block_review_on_incomplete_submittal?: boolean })
                  ?.block_review_on_incomplete_submittal ?? false;
              } else {
                const { data: byOwner } = await admin
                  .from("firm_settings")
                  .select("block_review_on_incomplete_submittal")
                  .eq("user_id", ownerUserId ?? "00000000-0000-0000-0000-000000000000")
                  .maybeSingle();
                block = (byOwner as { block_review_on_incomplete_submittal?: boolean } | null)
                  ?.block_review_on_incomplete_submittal ?? false;
              }
            }
            if (block) {
              const missingLabel = (m.missing ?? []).join(", ") || "required disciplines";
              await setStage(admin, plan_review_id, firmId, stageToRun, {
                status: "error",
                error_message: `Submittal gate: incomplete set — missing ${missingLabel}. Re-upload the missing trades or disable the firm-level submittal block to continue.`,
                metadata: meta as Record<string, unknown>,
              });
              return;
            }
          }
        }

        if (await isCancelled()) return;
        const idx = effectiveChain.indexOf(stageToRun);
        const next = idx >= 0 ? effectiveChain[idx + 1] : undefined;
        if (next) {
          // Don't double-schedule: the watchdog or a recovery worker may have
          // already advanced the chain.
          const { data: nextRow } = await admin
            .from("review_pipeline_status")
            .select("status")
            .eq("plan_review_id", plan_review_id)
            .eq("stage", next)
            .maybeSingle();
          const ns = (nextRow as { status?: string } | null)?.status;
          if (ns !== "running" && ns !== "complete") {
            scheduleNextStage(plan_review_id, next, { mode: effectiveMode });
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const errName = err instanceof Error ? err.name : "";

        // LOW_YIELD_REVIEW: pipeline already wrote ai_check_status='needs_human_review'.
        if (message.includes("LOW_YIELD_REVIEW")) {
          await setStage(admin, plan_review_id, firmId, stageToRun, {
            status: "error",
            error_message: message,
            metadata: { error_class: "LOW_YIELD_REVIEW" },
          });
          return;
        }

        // No-files-uploaded is a user error, not a transient pipeline failure.
        // Skip the 3× retry loop and flip the review to needs_user_action so
        // the upload re-prompt surfaces immediately.
        if (errName === "NoFilesUploadedError" || stageToRun === "upload") {
          if (errName === "NoFilesUploadedError" || message.toLowerCase().includes("no files uploaded")) {
            await recordPipelineError(admin, {
              planReviewId: plan_review_id,
              firmId,
              stage: "upload",
              errorClass: "no_files_uploaded",
              errorMessage: message,
              severity: "warn",
            });
            await setStage(admin, plan_review_id, firmId, "upload", {
              status: "error",
              error_message:
                "No PDF files have been uploaded yet. Re-upload the plan set to start the review.",
              metadata: { error_class: "no_files_uploaded" },
            });
            await mergeProgress(admin, plan_review_id, {
              failure_reason: "No PDF files have been uploaded for this plan review yet.",
              needs_user_action_stage: "upload",
              needs_user_action_at: new Date().toISOString(),
            });
            await admin
              .from("plan_reviews")
              .update({
                ai_check_status: "needs_user_action",
                updated_at: new Date().toISOString(),
              })
              .eq("id", plan_review_id);
            return;
          }
        }

        // prepare_pages is verify-only here. A throw means the manifest is
        // missing/corrupt — only the BROWSER can rasterize the source PDFs.
        if (stageToRun === "prepare_pages") {
          const isNeedsBrowser = message.includes(NEEDS_BROWSER_RASTERIZATION);
          const userMessage = isNeedsBrowser
            ? "This review's pages haven't been prepared. Click \"Re-prepare in browser\" on the dashboard to render them locally."
            : `prepare_pages failed: ${message}`;
          await recordPipelineError(admin, {
            planReviewId: plan_review_id,
            firmId,
            stage: "prepare_pages",
            errorClass: isNeedsBrowser ? NEEDS_BROWSER_RASTERIZATION : "prepare_pages_failed",
            errorMessage: message,
          });
          await setStage(admin, plan_review_id, firmId, "prepare_pages", {
            status: "error",
            error_message: userMessage,
            metadata: { error_class: isNeedsBrowser ? NEEDS_BROWSER_RASTERIZATION : "prepare_pages_failed" },
          });
          // Don't make the user wait 15 minutes for the watchdog. Flip the
          // review to needs_user_action immediately so StuckRecoveryBanner
          // surfaces the "Re-prepare in browser" CTA on this very page load.
          if (isNeedsBrowser) {
            // Atomic merge so we don't clobber other progress keys (chunk
            // beacons, DNA confirmation, etc.) that may have been written by
            // a still-running parallel stage.
            await mergeProgress(admin, plan_review_id, {
              failure_reason: userMessage,
              needs_user_action_stage: "prepare_pages",
              needs_user_action_at: new Date().toISOString(),
            });
            await admin
              .from("plan_reviews")
              .update({
                ai_check_status: "needs_user_action",
                updated_at: new Date().toISOString(),
              })
              .eq("id", plan_review_id);
          }
          return;
        }

        // Non-fatal stages get bounded retry — a single transient AI gateway
        // hiccup at sheet_map or dedupe used to strand the chain.
        const NON_FATAL_RETRY_STAGES = new Set<Stage>([
          "sheet_map",
          "discipline_review",
          "critic",
          "verify",
          "dedupe",
          "ground_citations",
          "challenger",
          "cross_check",
          "deferred_scope",
          "prioritize",
        ]);
        if (NON_FATAL_RETRY_STAGES.has(stageToRun)) {
          const { data: existingRow } = await admin
            .from("review_pipeline_status")
            .select("metadata")
            .eq("plan_review_id", plan_review_id)
            .eq("stage", stageToRun)
            .maybeSingle();
          const existingMeta =
            (existingRow as { metadata?: Record<string, unknown> | null } | null)?.metadata ??
            {};
          const attemptsKey = `${stageToRun}_attempts`;
          const attempts =
            typeof (existingMeta as Record<string, unknown>)[attemptsKey] === "number"
              ? ((existingMeta as Record<string, number>)[attemptsKey] as number) + 1
              : 1;
          if (attempts <= 3) {
            console.warn(
              `[${stageToRun}] attempt ${attempts}/3 failed (${message}) — re-scheduling in 2s`,
            );
            await setStage(admin, plan_review_id, firmId, stageToRun, {
              status: "pending",
              metadata: { ...existingMeta, [attemptsKey]: attempts, last_error: message },
            });
            setTimeout(() => {
              scheduleNextStage(plan_review_id, stageToRun, { mode: effectiveMode });
            }, 2000);
            return;
          }
        }

        await setStage(admin, plan_review_id, firmId, stageToRun, {
          status: "error",
          error_message: message,
        });
        // For non-fatal stages, still try to advance so the user gets partial
        // results. `upload` and `dna_extract` halt the chain.
        const isFatal = stageToRun === "upload" || stageToRun === "dna_extract";
        if (!isFatal) {
          if (await isCancelled()) return;
          const idx = effectiveChain.indexOf(stageToRun);
          const next = idx >= 0 ? effectiveChain[idx + 1] : undefined;
          if (next) scheduleNextStage(plan_review_id, next, { mode: effectiveMode });
        }
      }
    };

    const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } })
      .EdgeRuntime;
    if (edgeRuntime?.waitUntil) {
      edgeRuntime.waitUntil(
        runOneStage().catch((e) => console.error(`stage ${stageToRun} background error:`, e)),
      );
    } else {
      runOneStage().catch((e) => console.error(`stage ${stageToRun} background error:`, e));
    }

    return new Response(
      JSON.stringify({ ok: true, accepted: true, plan_review_id, stage: stageToRun, mode: effectiveMode }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 202,
      },
    );
  } catch (e) {
    console.error("run-review-pipeline fatal:", e);
    const message = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
