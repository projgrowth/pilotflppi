// Edge function: orchestrates the 8-stage plan review pipeline.
// Writes per-stage status to public.review_pipeline_status so the dashboard
// stepper updates in realtime. Each stage is isolated: a failure marks that
// stage 'error' and (where it makes sense) flags the discipline as
// requires_human_review on downstream deficiencies, but the overall pipeline
// continues to the next stage where possible.
//
// Phase A refactor (2026-04-27): leaf utilities now live in `_shared/*`.
// Stage implementations still live in this file pending Phase B/C extraction.
// The `CURRENT_COST_CTX` mutable singleton lives ONLY in `_shared/cost.ts` —
// importing two copies would silently break cost attribution.

import { composeDisciplineSystemPrompt } from "./discipline-experts.ts";

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
  type ChatMessage,
  STAGES,
  stagesForMode,
  DISCIPLINES,
  normalizeAIDiscipline,
  disciplineForSheetFallback,
  mapSeverityToPriority,
  NEEDS_BROWSER_RASTERIZATION,
} from "./_shared/types.ts";
import { setStage, recordPipelineError } from "./_shared/pipeline-status.ts";
import { withRetry } from "./_shared/retry.ts";
import { setCostCtx, withCostCtx } from "./_shared/cost.ts";
import { callAI } from "./_shared/ai.ts";
import {
  signedSheetUrls,
  invalidatePageManifestCache,
} from "./_shared/storage.ts";

// Re-export `LOVABLE_API_KEY` reference is no longer needed locally — `callAI`
// owns the gateway call. Keep this comment so the next refactor doesn't add
// it back as "missing".




const FINDINGS_SCHEMA = {
  name: "submit_discipline_findings",
  description:
    "Return discipline-specific deficiencies grounded in visible evidence on the supplied plan sheets. If a required item is not visible, raise a deficiency with requires_human_review=true.",
  parameters: {
    type: "object",
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            finding: {
              type: "string",
              description: "1–2 plain-language sentences describing the deficiency.",
            },
            required_action: {
              type: "string",
              description: "Specific corrective action the design team must take.",
            },
            sheet_refs: {
              type: "array",
              items: { type: "string" },
              description: "Sheet identifier(s) the finding cites (e.g. A-101).",
            },
            code_section: {
              type: "string",
              description: "FBC section or other code reference (e.g. 1006.2.1).",
            },
            evidence: {
              type: "array",
              items: { type: "string" },
              description:
                "Verbatim text snippets read from the plan sheets that support the finding (max 3, ≤200 chars each). Empty if missing-information finding.",
            },
            confidence_score: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
            confidence_basis: {
              type: "string",
              description:
                "Why this confidence — what was directly visible vs inferred.",
            },
            life_safety_flag: { type: "boolean" },
            permit_blocker: { type: "boolean" },
            liability_flag: { type: "boolean" },
            requires_human_review: { type: "boolean" },
            human_review_reason: { type: "string" },
            human_review_verify: { type: "string" },
            priority: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: [
            "finding",
            "required_action",
            "sheet_refs",
            "evidence",
            "confidence_score",
            "confidence_basis",
            "priority",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["findings"],
    additionalProperties: false,
  },
} as const;

// ---------- stage implementations ----------
// Note: these are intentionally lightweight scaffolds. They populate the new
// tables with sensible records so the dashboard renders, and provide the
// integration points for the deeper Gemini extraction work in the next PR.

// Phase B refactor (2026-04-27): intake + DNA stages now live in `./stages/*`.
// `evaluateDnaHealth` and the `DnaHealth` type are exported from `stages/dna.ts`
// so the orchestrator (below) can read the `blocking` field at the DNA gate.
import { stageUpload } from "./stages/upload.ts";
import { stagePreparePages } from "./stages/prepare-pages.ts";
import { stageSheetMap } from "./stages/sheet-map.ts";
import { stageSubmittalCheck } from "./stages/submittal-check.ts";
import {
  stageDnaExtract,
  stageDnaReevaluate,
  type DnaHealth,
} from "./stages/dna.ts";

// `Finding.severity` (critical|major|minor) → `deficiencies_v2.priority`
// (high|medium|low) — see mapSeverityToPriority in `_shared/types.ts`.



async function stageDisciplineReview(
  admin: ReturnType<typeof createClient>,
  planReviewId: string,
  firmId: string | null,
) {
  // Load context once and share across all discipline calls.
  const [sheets, signedUrls, dnaRow, jurisdictionRow, reviewMetaRow] = await Promise.all([
    admin
      .from("sheet_coverage")
      .select("sheet_ref, sheet_title, discipline, page_index")
      .eq("plan_review_id", planReviewId)
      .order("page_index", { ascending: true }),
    signedSheetUrls(admin, planReviewId),
    admin
      .from("project_dna")
      .select("*")
      .eq("plan_review_id", planReviewId)
      .maybeSingle(),
    admin
      .from("plan_reviews")
      .select("projects(county, use_type)")
      .eq("id", planReviewId)
      .maybeSingle(),
    admin
      .from("plan_reviews")
      .select("round, previous_findings, checklist_state, stage_checkpoints")
      .eq("id", planReviewId)
      .maybeSingle(),
  ]);

  // Stage start timestamp for the soft 120s mid-stage timeout safety net.
  // If a discipline loop is still running when we cross the threshold, we
  // persist progress and self-reschedule rather than risk hitting the
  // edge function's hard 150s wall.
  const stageStartedAt = Date.now();
  const STAGE_SOFT_TIMEOUT_MS = 120_000;

  // Resumable chunk checkpoints. `stage_checkpoints.discipline_review` is a
  // map of `{ [discipline]: lastChunkCompleted }`. On retry we skip every
  // chunk index up to and including the saved value so we don't pay for
  // chunks already represented by upserted def_numbers.
  const checkpointsRow = (reviewMetaRow.data ?? null) as
    | { stage_checkpoints?: Record<string, unknown> | null }
    | null;
  const allCheckpoints = (checkpointsRow?.stage_checkpoints ?? {}) as Record<
    string,
    Record<string, number>
  >;
  const disciplineCheckpoints: Record<string, number> = {
    ...((allCheckpoints.discipline_review ?? {}) as Record<string, number>),
  };
  const persistDisciplineCheckpoint = async (discipline: string, chunkIdx: number) => {
    disciplineCheckpoints[discipline] = chunkIdx;
    const next = {
      ...allCheckpoints,
      discipline_review: { ...disciplineCheckpoints },
    };
    await admin
      .from("plan_reviews")
      .update({ stage_checkpoints: next })
      .eq("id", planReviewId);
  };

  const allSheets = (sheets.data ?? []) as Array<{
    sheet_ref: string;
    sheet_title: string | null;
    discipline: string | null;
    page_index: number | null;
  }>;

  // Round-2 diff intelligence. If we're past round 1 AND the prior
  // sheet_map snapshot exists, classify each sheet as "changed" or
  // "unchanged". Unchanged sheets get carryover findings from
  // previous_findings instead of an AI call. All other rounds (round=1
  // or no prior snapshot) fall through to the existing full-AI path.
  const reviewMeta = (reviewMetaRow.data ?? null) as
    | { round: number; previous_findings: unknown; checklist_state: Record<string, unknown> | null }
    | null;
  const round = reviewMeta?.round ?? 1;
  const checklistState = (reviewMeta?.checklist_state ?? {}) as Record<string, unknown>;
  const lastSheetMap =
    Array.isArray(checklistState.last_sheet_map) ? (checklistState.last_sheet_map as Array<{
      sheet_ref: string;
      page_index: number | null;
      discipline: string | null;
    }>) : null;
  const priorFindings: Array<Record<string, unknown>> = Array.isArray(reviewMeta?.previous_findings)
    ? (reviewMeta!.previous_findings as Array<Record<string, unknown>>)
    : [];

  const unchangedSheetRefs = new Set<string>();
  if (round >= 2 && lastSheetMap && lastSheetMap.length > 0) {
    const priorByRef = new Map(lastSheetMap.map((p) => [p.sheet_ref, p]));
    for (const s of allSheets) {
      const prior = priorByRef.get(s.sheet_ref);
      if (
        prior &&
        prior.page_index === s.page_index &&
        (prior.discipline ?? "") === (s.discipline ?? "")
      ) {
        unchangedSheetRefs.add(s.sheet_ref);
      }
    }
  }

  // Insert carryover deficiencies for each prior finding whose sheet is
  // unchanged. Marked open + metadata.carryover_from_round so the UI
  // panel + filter chip can find them. Done before the main loop so the
  // dashboard sees them immediately.
  let carryoverInserted = 0;
  if (unchangedSheetRefs.size > 0 && priorFindings.length > 0) {
    const carryRows: Array<Record<string, unknown>> = [];
    for (const pf of priorFindings) {
      const page = typeof pf.page === "string" ? pf.page : "";
      // Match either the literal sheet_ref string or the first sheet in a
      // comma list ("A-101" or "A-101, A-102").
      const firstSheet = page.split(",")[0]?.trim() ?? "";
      if (!firstSheet || !unchangedSheetRefs.has(firstSheet)) continue;
      const desc = typeof pf.description === "string" ? pf.description : "";
      const codeRef = typeof pf.code_ref === "string" ? pf.code_ref : "";
      const discipline = typeof pf.discipline === "string" ? pf.discipline : "Architectural";
      carryRows.push({
        plan_review_id: planReviewId,
        firm_id: firmId,
        def_number: `CARRY-R${round - 1}-${carryRows.length + 1}`,
        discipline,
        finding: desc.slice(0, 2000) || "Carried over from prior round",
        required_action: typeof pf.recommendation === "string" ? pf.recommendation.slice(0, 2000) : "Verify resolution.",
        priority: typeof pf.severity === "string" ? mapSeverityToPriority(pf.severity) : "medium",
        sheet_refs: [firstSheet],
        code_reference: codeRef ? { section: codeRef } : {},
        evidence: [],
        status: "open",
        verification_status: "carryover",
        verification_notes: `Sheet ${firstSheet} unchanged from round ${round - 1}; finding replayed without re-review.`,
        evidence_crop_meta: { carryover_from_round: round - 1, source_sheet: firstSheet },
      });
    }
    if (carryRows.length > 0) {
      const { error: cErr } = await admin.from("deficiencies_v2").insert(carryRows);
      if (cErr) {
        console.error("[discipline_review] carryover insert failed:", cErr);
      } else {
        carryoverInserted = carryRows.length;
      }
    }
  }

  const dna = (dnaRow.data ?? null) as Record<string, unknown> | null;
  const jurisdictionProject = (jurisdictionRow.data ?? null) as
    | { projects: { county: string; use_type: string | null } | null }
    | null;
  const county = jurisdictionProject?.projects?.county ?? null;
  const useType = jurisdictionProject?.projects?.use_type ?? null;

  let jurisdiction: Record<string, unknown> | null = null;
  if (county) {
    const { data: jr } = await admin
      .from("jurisdictions_fl")
      .select("*")
      .eq("county", county)
      .maybeSingle();
    jurisdiction = (jr ?? null) as Record<string, unknown> | null;
  }

  // Residential 1-2 family projects don't need a commercial accessibility
  // (ADA / FBC Ch.11) review — skip that discipline entirely so the AI
  // doesn't manufacture irrelevant findings.
  const disciplinesToRun = useType === "residential"
    ? DISCIPLINES.filter((d) => d !== "Accessibility")
    : DISCIPLINES;

  // Resolve each sheet's discipline: prefer the AI-extracted title-block
  // discipline (sheet_coverage.discipline). Fall back to prefix heuristic ONLY
  // for sheets the AI labelled General/Other but whose prefix is unambiguous.
  type RoutedSheet = {
    sheet_ref: string;
    sheet_title: string | null;
    page_index: number | null;
    discipline: string | null; // resolved discipline (one of DISCIPLINES) or null = general
  };
  const routed: RoutedSheet[] = allSheets.map((s) => {
    const aiResolved = normalizeAIDiscipline(s.discipline);
    const fallback = aiResolved === null ? disciplineForSheetFallback(s.sheet_ref) : null;
    return {
      sheet_ref: s.sheet_ref,
      sheet_title: s.sheet_title,
      page_index: s.page_index,
      discipline: aiResolved ?? fallback,
    };
  });

  // Smart chunking — first 2 "general notes" pages (cover/title/code summary) seed every call.
  const generalSheets = routed.filter((s) => s.discipline === null).slice(0, 2);
  const generalImageUrls = generalSheets
    .map((s) => signedUrls[s.page_index ?? -1]?.signed_url)
    .filter(Boolean) as string[];

  const failed: string[] = [];
  let totalFindings = 0;

  // Per-discipline budget. The DISCIPLINE_BATCH keeps each AI call's payload
  // bounded; the ceiling is a safety stop only (real protection lives in the
  // chunk-count cap below, which guards token/cost runaway on freak sets).
  const DISCIPLINE_BATCH = 8;
  const MAX_SHEETS_PER_DISCIPLINE = 200; // ≈ 25 chunks at 8 sheets/chunk
  const MAX_CHUNKS_PER_DISCIPLINE = 18;  // hard time-bound: ~18 AI calls per discipline

  // Track coverage so we can persist a truthful review_coverage row.
  const byDiscipline: Record<string, { reviewed: number; total: number }> = {};
  let cappedAt: number | null = null;

  // Per-chunk cancellation: if the user clicks Cancel mid-discipline_review
  // we should NOT keep firing the next 9 AI calls. Reuse the same field the
  // dispatcher reads.
  const checkCancelled = async (): Promise<boolean> => {
    const { data } = await admin
      .from("plan_reviews")
      .select("ai_run_progress")
      .eq("id", planReviewId)
      .maybeSingle();
    const progress =
      (data as { ai_run_progress?: Record<string, unknown> | null } | null)
        ?.ai_run_progress ?? {};
    return typeof progress.cancelled_at === "string" && progress.cancelled_at.length > 0;
  };

  let cancelledMidRun = false;

  for (const discipline of disciplinesToRun) {
    if (cancelledMidRun) break;
    try {
      // Round-2 diff: skip sheets we already classified as unchanged. We
      // don't need to re-run the AI on them — carryover findings were
      // inserted at the top of this stage.
      const disciplineSheets = routed.filter(
        (s) => s.discipline === discipline && !unchangedSheetRefs.has(s.sheet_ref),
      );
      const allUrls = disciplineSheets
        .map((s) => signedUrls[s.page_index ?? -1]?.signed_url)
        .filter(Boolean) as string[];

      // Total reflects the FULL discipline footprint (changed + unchanged)
      // so the coverage chip reads "74/74" even when we only ran AI on 2.
      const totalForDiscipline = routed.filter((s) => s.discipline === discipline).length;
      byDiscipline[discipline] = { reviewed: totalForDiscipline - disciplineSheets.length, total: totalForDiscipline };

      // Skip silently if no sheets routed to this discipline.
      if (allUrls.length === 0) continue;

      const cappedUrls = allUrls.slice(0, MAX_SHEETS_PER_DISCIPLINE);
      if (allUrls.length > MAX_SHEETS_PER_DISCIPLINE) {
        cappedAt = MAX_SHEETS_PER_DISCIPLINE;
      }

      // Chunk by DISCIPLINE_BATCH so a 74-sheet Architectural set runs ~10
      // calls instead of 1 oversized call that the model can't handle.
      let disciplineFindings = 0;
      let chunksRun = 0;
      let lastReviewedSheets = 0;
      const totalChunks = Math.ceil(cappedUrls.length / DISCIPLINE_BATCH);
      // Resume support: skip every chunk index up to the last persisted one.
      const resumeFrom = disciplineCheckpoints[discipline] ?? -1;
      if (resumeFrom >= 0) {
        await recordPipelineError(admin, {
          planReviewId,
          firmId,
          stage: "discipline_review",
          errorClass: "chunk_resume",
          errorMessage: `${discipline}: resuming after chunk ${resumeFrom + 1}/${totalChunks} (skipping prior chunks).`,
          metadata: { discipline, resume_after_chunk: resumeFrom + 1, total_chunks: totalChunks },
        });
      }
      for (let cs = 0; cs < cappedUrls.length; cs += DISCIPLINE_BATCH) {
        const chunkIdx = Math.floor(cs / DISCIPLINE_BATCH);
        // Skip already-completed chunks from a prior failed run.
        if (chunkIdx <= resumeFrom) {
          chunksRun++;
          lastReviewedSheets = Math.min(cs + DISCIPLINE_BATCH, cappedUrls.length);
          continue;
        }
        if (await checkCancelled()) {
          cancelledMidRun = true;
          break;
        }
        // Soft timeout safety net: if we're approaching the edge function's
        // hard 150s wall, persist the checkpoint and bail out cleanly so the
        // dispatcher / cron recovery can re-invoke and resume from here.
        if (Date.now() - stageStartedAt > STAGE_SOFT_TIMEOUT_MS) {
          await recordPipelineError(admin, {
            planReviewId,
            firmId,
            stage: "discipline_review",
            errorClass: "soft_timeout",
            errorMessage: `${discipline}: paused at chunk ${chunkIdx}/${totalChunks} after ${Math.round((Date.now() - stageStartedAt) / 1000)}s — will resume on next dispatcher tick.`,
            metadata: { discipline, paused_at_chunk: chunkIdx, total_chunks: totalChunks, elapsed_ms: Date.now() - stageStartedAt },
          });
          // Throw so the outer dispatcher's withRetry / status writer flips
          // the stage back to a retryable state. The persisted checkpoint
          // ensures the next attempt starts at the right chunk.
          throw new Error(`SOFT_TIMEOUT: discipline_review paused at ${discipline} chunk ${chunkIdx}/${totalChunks}`);
        }
        if (chunksRun >= MAX_CHUNKS_PER_DISCIPLINE) {
          cappedAt = lastReviewedSheets;
          await recordPipelineError(admin, {
            planReviewId,
            firmId,
            stage: "discipline_review",
            errorClass: "chunk_ceiling",
            errorMessage: `${discipline}: stopped after ${chunksRun} chunks (~${lastReviewedSheets} sheets) to bound runtime.`,
            metadata: { discipline, chunks_run: chunksRun, sheets_total: cappedUrls.length },
          });
          break;
        }
        const chunkUrls = cappedUrls.slice(cs, cs + DISCIPLINE_BATCH);
        const chunkSheets = disciplineSheets.slice(cs, cs + DISCIPLINE_BATCH);
        const inserted = await runDisciplineChecks(admin, planReviewId, firmId, {
          discipline,
          disciplineSheets: chunkSheets,
          disciplineImageUrls: chunkUrls,
          generalImageUrls,
          dna,
          jurisdiction,
          useType,
        });
        disciplineFindings += inserted;
        chunksRun++;
        lastReviewedSheets = cs + chunkSheets.length;
        // Persist checkpoint after each successful chunk so a failure on the
        // next one is cheap to retry.
        await persistDisciplineCheckpoint(discipline, chunkIdx);
        // Per-chunk audit row so the dashboard error tab shows progress.
        await recordPipelineError(admin, {
          planReviewId,
          firmId,
          stage: "discipline_review",
          errorClass: "chunk_summary",
          errorMessage: `${discipline}: chunk ${chunksRun}/${totalChunks} → ${inserted} finding${inserted === 1 ? "" : "s"} (sheets ${cs + 1}-${lastReviewedSheets}).`,
          metadata: { discipline, chunk: chunksRun, total_chunks: totalChunks, findings: inserted },
        });
      }
      totalFindings += disciplineFindings;
      // Reviewed = (carryover unchanged) + (newly reviewed by AI in this run)
      byDiscipline[discipline].reviewed = byDiscipline[discipline].reviewed + lastReviewedSheets;
    } catch (err) {
      console.error(`[discipline_review:${discipline}] failed:`, err);
      failed.push(discipline);
      await admin.from("deficiencies_v2").insert({
        plan_review_id: planReviewId,
        firm_id: firmId,
        def_number: `DEF-HR-${discipline.replace(/\s+/g, "").slice(0, 6).toUpperCase()}`,
        discipline,
        finding: `${discipline} review could not complete automatically.`,
        required_action: `Reviewer must perform ${discipline} review manually.`,
        priority: "medium",
        requires_human_review: true,
        human_review_reason: `Automated ${discipline} discipline check failed after retries.`,
        human_review_method: "Full manual discipline review using checklist.",
        status: "open",
      });
    }
  }

  // If user cancelled mid-run, persist what we have and signal cancellation
  // so the dispatcher's standard cancellation path runs.
  if (cancelledMidRun) {
    const partialTotal = Object.values(byDiscipline).reduce((s, v) => s + v.total, 0);
    const partialReviewed = Object.values(byDiscipline).reduce((s, v) => s + v.reviewed, 0);
    try {
      await admin.from("review_coverage").upsert(
        {
          plan_review_id: planReviewId,
          firm_id: firmId,
          sheets_total: partialTotal,
          sheets_reviewed: partialReviewed,
          by_discipline: byDiscipline,
          capped_at: cappedAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "plan_review_id" },
      );
    } catch (err) {
      console.error("[discipline_review] failed to persist partial review_coverage:", err);
    }
    throw new Error("Cancelled by user");
  }

  // Persist truthful coverage so the workspace chip can show e.g. 78/78.
  const sheetsTotal = Object.values(byDiscipline).reduce((s, v) => s + v.total, 0);
  const sheetsReviewed = Object.values(byDiscipline).reduce((s, v) => s + v.reviewed, 0);
  try {
    await admin
      .from("review_coverage")
      .upsert(
        {
          plan_review_id: planReviewId,
          firm_id: firmId,
          sheets_total: sheetsTotal,
          sheets_reviewed: sheetsReviewed,
          by_discipline: byDiscipline,
          capped_at: cappedAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "plan_review_id" },
      );
  } catch (err) {
    console.error("[discipline_review] failed to persist review_coverage:", err);
  }

  // Stage finished cleanly — clear discipline checkpoints so a future re-run
  // (e.g., a manual rerun after reviewer disposition) starts fresh.
  if (Object.keys(disciplineCheckpoints).length > 0) {
    const cleared = { ...allCheckpoints };
    delete (cleared as Record<string, unknown>).discipline_review;
    await admin
      .from("plan_reviews")
      .update({ stage_checkpoints: cleared })
      .eq("id", planReviewId);
  }

  // LOW_YIELD guard: a multi-page review that produced 0 findings is almost
  // certainly a bad rasterize → empty DNA → AI saw nothing pattern. Refuse to
  // mark complete; surface as needs_human_review for manual disposition.
  const expectedPages = allSheets.length;
  if (totalFindings === 0 && carryoverInserted === 0 && expectedPages > 5 && failed.length === 0) {
    const reason = `Pipeline produced 0 findings on ${expectedPages} sheets. Likely a bad upload or empty rasterize — please review manually.`;
    await admin
      .from("plan_reviews")
      .update({
        ai_check_status: "needs_human_review",
        ai_run_progress: {
          failure_reason: reason,
          low_yield_at: new Date().toISOString(),
          expected_pages: expectedPages,
          total_findings: 0,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", planReviewId);
    await recordPipelineError(admin, {
      planReviewId,
      firmId,
      stage: "discipline_review",
      errorClass: "LOW_YIELD_REVIEW",
      errorMessage: reason,
      metadata: { expected_pages: expectedPages, sheets: allSheets.length },
    });
    throw new Error(`LOW_YIELD_REVIEW: ${reason}`);
  }

  return {
    failed_disciplines: failed,
    total_findings: totalFindings,
    carryover_inserted: carryoverInserted,
    unchanged_sheets: unchangedSheetRefs.size,
    round,
  };
}

interface DisciplineRunCtx {
  discipline: string;
  disciplineSheets: Array<{ sheet_ref: string; sheet_title: string | null }>;
  disciplineImageUrls: string[];
  generalImageUrls: string[];
  dna: Record<string, unknown> | null;
  jurisdiction: Record<string, unknown> | null;
  useType: string | null;
}

async function runDisciplineChecks(
  admin: ReturnType<typeof createClient>,
  planReviewId: string,
  firmId: string | null,
  ctx: DisciplineRunCtx,
): Promise<number> {
  // Pull this discipline's negative-space checklist (deterministic must-checks).
  const { data: items } = await admin
    .from("discipline_negative_space")
    .select("item_key, description, fbc_section, trigger_condition")
    .eq("discipline", ctx.discipline)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  const checklist = (items ?? []) as Array<{
    item_key: string;
    description: string;
    fbc_section: string | null;
    trigger_condition: string | null;
  }>;

  const dnaSummary = ctx.dna
    ? JSON.stringify(
        {
          occupancy: ctx.dna.occupancy_classification,
          construction_type: ctx.dna.construction_type,
          stories: ctx.dna.stories,
          total_sq_ft: ctx.dna.total_sq_ft,
          wind_speed_vult: ctx.dna.wind_speed_vult,
          exposure_category: ctx.dna.exposure_category,
          risk_category: ctx.dna.risk_category,
          flood_zone: ctx.dna.flood_zone,
          hvhz: ctx.dna.hvhz,
          mixed_occupancy: ctx.dna.mixed_occupancy,
          is_high_rise: ctx.dna.is_high_rise,
          has_mezzanine: ctx.dna.has_mezzanine,
          missing_fields: ctx.dna.missing_fields,
        },
        null,
        2,
      )
    : "(not yet extracted)";

  const jurSummary = ctx.jurisdiction
    ? JSON.stringify(
        {
          county: ctx.jurisdiction.county,
          fbc_edition: ctx.jurisdiction.fbc_edition,
          hvhz: ctx.jurisdiction.hvhz,
          coastal: ctx.jurisdiction.coastal,
          flood_zone_critical: ctx.jurisdiction.flood_zone_critical,
          high_volume: ctx.jurisdiction.high_volume,
          notes: ctx.jurisdiction.notes,
        },
        null,
        2,
      )
    : "(unknown jurisdiction)";

  const checklistText = checklist.length
    ? checklist
        .map(
          (c, i) =>
            `${i + 1}. [${c.item_key}] ${c.description}${
              c.fbc_section ? ` (FBC ${c.fbc_section})` : ""
            }${c.trigger_condition ? ` — only if: ${c.trigger_condition}` : ""}`,
        )
        .join("\n")
    : "(no checklist seeded — rely on discipline best practices)";

  const sheetIndex = ctx.disciplineSheets
    .map((s) => `${s.sheet_ref}${s.sheet_title ? ` — ${s.sheet_title}` : ""}`)
    .join("\n");

  // -------- Reviewer Memory: inject learned correction patterns --------
  const occupancy = (ctx.dna?.occupancy_classification as string | null) ?? null;
  const constructionType = (ctx.dna?.construction_type as string | null) ?? null;
  const fbcEdition = (ctx.dna?.fbc_edition as string | null) ?? null;
  // Reliability score: rejection_count - confirm_count. A pattern reviewers
  // later confirmed (high confirm_count) stops being injected as a warning.
  let patternQuery = admin
    .from("correction_patterns")
    .select("id, pattern_summary, original_finding, code_reference, reason_notes, rejection_count, confirm_count, occupancy_classification, construction_type")
    .eq("discipline", ctx.discipline)
    .eq("is_active", true)
    .order("last_seen_at", { ascending: false })
    .limit(40);
  if (firmId) patternQuery = patternQuery.eq("firm_id", firmId);
  const { data: patternsData } = await patternQuery;
  const patterns = (patternsData ?? []) as Array<{
    id: string;
    pattern_summary: string;
    original_finding: string;
    code_reference: { section?: string } | null;
    reason_notes: string;
    rejection_count: number;
    confirm_count: number;
    occupancy_classification: string | null;
    construction_type: string | null;
  }>;
  // Score = rejections − confirmations. Drop anything ≤ 0 (the AI was right
  // more often than wrong) and sort by score so the noisiest patterns lead.
  const scored = patterns
    .map((p) => ({ ...p, score: (p.rejection_count ?? 0) - (p.confirm_count ?? 0) }))
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score);
  const relevantPatterns = scored.filter((p) =>
    (!p.occupancy_classification || p.occupancy_classification === occupancy) &&
    (!p.construction_type || p.construction_type === constructionType)
  ).slice(0, 12);

  const learnedText = relevantPatterns.length
    ? relevantPatterns
        .map(
          (p, i) =>
            `${i + 1}. ${p.pattern_summary}${p.reason_notes ? ` — Note: ${p.reason_notes}` : ""} (rejected ${p.rejection_count}× by senior reviewers)`,
        )
        .join("\n")
    : null;

  // Persist which patterns were applied so the dashboard can show them.
  if (relevantPatterns.length) {
    await admin.from("applied_corrections").insert(
      relevantPatterns.map((p) => ({
        plan_review_id: planReviewId,
        firm_id: firmId,
        pattern_id: p.id,
        discipline: ctx.discipline,
        pattern_summary: p.pattern_summary,
      })),
    );
  }

  const memoryBlock = learnedText
    ? `\n\n## LEARNED CORRECTIONS — your firm's senior reviewers previously rejected these.\nDo NOT re-flag these unless you have strong new evidence on the plans:\n${learnedText}\n`
    : "";

  // Hand-tuned discipline expert prompt: persona + must-check domains +
  // common failure modes + wording/evidence guidance + shared review rules.
  const systemPrompt = composeDisciplineSystemPrompt(ctx.discipline);

  // Use-type prefix tells the expert which FBC code path applies before they
  // start reading sheets — prevents commercial-coded findings on residential.
  const useTypeLine = ctx.useType === "residential"
    ? `## Project Use Type\nRESIDENTIAL — apply FBC Residential (FBCR), NOT FBC Building. Skip commercial accessibility (FBC Ch.11). Use IRC/FBCR-style code references.\n\n`
    : ctx.useType === "commercial"
      ? `## Project Use Type\nCOMMERCIAL — apply FBC Building (not FBCR). Accessibility (FBC Ch.11/ADA) and commercial life-safety apply.\n\n`
      : ``;

  const userText =
    useTypeLine +
    `## Project DNA\n${dnaSummary}\n\n` +
    `## Jurisdiction\n${jurSummary}\n\n` +
    `## Sheets routed to ${ctx.discipline}\n${sheetIndex || "(none)"}\n\n` +
    `## Mandatory ${ctx.discipline} checklist\n${checklistText}` +
    memoryBlock +
    `\n\nAnalyze the attached pages (general-notes pages first, then ${ctx.discipline} sheets). ` +
    `Return findings via submit_discipline_findings.`;

  // fbcEdition is available for future prompt injection if needed.
  void fbcEdition;

  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [
    { type: "text", text: userText },
    ...ctx.generalImageUrls.map((u) => ({
      type: "image_url" as const,
      image_url: { url: u },
    })),
    ...ctx.disciplineImageUrls.map((u) => ({
      type: "image_url" as const,
      image_url: { url: u },
    })),
  ];

  const result = (await callAI(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content },
    ],
    FINDINGS_SCHEMA as unknown as Record<string, unknown>,
  )) as {
    findings: Array<{
      finding: string;
      required_action: string;
      sheet_refs: string[];
      code_section?: string;
      evidence: string[];
      confidence_score: number;
      confidence_basis: string;
      life_safety_flag?: boolean;
      permit_blocker?: boolean;
      liability_flag?: boolean;
      requires_human_review?: boolean;
      human_review_reason?: string;
      human_review_verify?: string;
      priority: "high" | "medium" | "low";
    }>;
  };

  const findings = result?.findings ?? [];
  if (findings.length === 0) return 0;

  // Resolve the active prompt_version_id for this discipline so each finding
  // is stamped with the prompt that produced it. Cached per worker so we
  // don't refetch for every chunk in the same invocation.
  const promptVersionId = await getActivePromptVersionId(admin, ctx.discipline);

  // Compute the next def_number using MAX of existing rows for this
  // (plan_review, discipline) pair. Combined with the unique index on
  // (plan_review_id, def_number) and the upsert below, this keeps retries
  // idempotent: the second attempt will either reuse the same numbers (no-op)
  // or pick up where the first attempt left off.
  const prefix = `DEF-${ctx.discipline.slice(0, 1).toUpperCase()}`;
  const { data: existingRows } = await admin
    .from("deficiencies_v2")
    .select("def_number")
    .eq("plan_review_id", planReviewId)
    .eq("discipline", ctx.discipline)
    .like("def_number", `${prefix}%`);
  let maxIdx = 0;
  for (const r of (existingRows ?? []) as Array<{ def_number: string }>) {
    const m = r.def_number?.match(/(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!isNaN(n) && n > maxIdx) maxIdx = n;
    }
  }
  const baseIdx = maxIdx + 1;

  const rows = findings.map((f, i) => ({
    plan_review_id: planReviewId,
    firm_id: firmId,
    def_number: `${prefix}${String(baseIdx + i).padStart(3, "0")}`,
    discipline: ctx.discipline,
    sheet_refs: f.sheet_refs ?? [],
    code_reference: f.code_section
      ? { code: "FBC", section: f.code_section, edition: ctx.dna?.fbc_edition ?? "8th" }
      : {},
    finding: f.finding,
    required_action: f.required_action,
    evidence: (f.evidence ?? []).slice(0, 3).map((s) => s.slice(0, 200)),
    priority: f.priority ?? "medium",
    life_safety_flag: !!f.life_safety_flag,
    permit_blocker: !!f.permit_blocker,
    liability_flag: !!f.liability_flag,
    requires_human_review: !!f.requires_human_review,
    human_review_reason: f.human_review_reason ?? null,
    human_review_verify: f.human_review_verify ?? null,
    confidence_score: Math.max(0, Math.min(1, f.confidence_score ?? 0.5)),
    confidence_basis: f.confidence_basis ?? "Vision-extracted",
    model_version: "google/gemini-2.5-flash",
    prompt_version_id: promptVersionId,
    status: "open",
  }));

  // Idempotent insert: if a retry races us and inserts the same def_number,
  // the unique index makes the duplicate a no-op instead of erroring out.
  const { error } = await admin
    .from("deficiencies_v2")
    .upsert(rows, { onConflict: "plan_review_id,def_number", ignoreDuplicates: true });
  if (error) throw error;
  return rows.length;
}

// ---------- prompt versioning helpers ----------

const _promptVersionCache = new Map<string, string | null>();

async function getActivePromptVersionId(
  admin: ReturnType<typeof createClient>,
  promptKey: string,
): Promise<string | null> {
  if (_promptVersionCache.has(promptKey)) {
    return _promptVersionCache.get(promptKey) ?? null;
  }
  const { data } = await admin
    .from("prompt_versions")
    .select("id")
    .eq("prompt_key", promptKey)
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const id = (data as { id?: string } | null)?.id ?? null;
  _promptVersionCache.set(promptKey, id);
  return id;
}

interface DuplicateGroup {
  key: string;
  fbc_section: string;
  sheet_ref: string;
  deficiency_ids: string[];
  def_numbers: string[];
}

interface Contradiction {
  deficiency_id: string;
  def_number: string;
  finding: string;
  prior_round: number;
  prior_status: string;
  prior_finding: string;
  reason: string;
}

interface ConsistencyMismatch {
  category:
    | "door_schedule_vs_plan"
    | "occupant_load_sum"
    | "panel_schedule_vs_riser"
    | "structural_callout_missing"
    | "room_finish_vs_schedule"
    | "fixture_count_vs_plumbing"
    | "egress_width_vs_capacity"
    | "other";
  description: string;
  sheet_a: string;
  value_a: string;
  sheet_b: string;
  value_b: string;
  evidence: string[];
  severity: "high" | "medium" | "low";
  confidence_score: number;
  deficiency_id?: string;
  def_number?: string;
}

const CROSS_SHEET_SCHEMA = {
  name: "submit_cross_sheet_mismatches",
  description:
    "Identify CROSS-SHEET inconsistencies — numeric or callout mismatches where two sheets in the same submittal disagree. Examples: door schedule says 36\" but the floor plan shows 32\"; occupant load on the life-safety sheet doesn't equal the sum of room loads on architectural; electrical panel schedule kVA disagrees with the riser diagram; a structural beam callout is missing from the framing plan; plumbing fixture counts on the plumbing plan don't match the fixture schedule. Return ONLY mismatches you can prove with verbatim text from BOTH sheets. If you cannot quote both sides, do not return it.",
  parameters: {
    type: "object",
    properties: {
      mismatches: {
        type: "array",
        items: {
          type: "object",
          properties: {
            category: {
              type: "string",
              enum: [
                "door_schedule_vs_plan",
                "occupant_load_sum",
                "panel_schedule_vs_riser",
                "structural_callout_missing",
                "room_finish_vs_schedule",
                "fixture_count_vs_plumbing",
                "egress_width_vs_capacity",
                "other",
              ],
            },
            description: {
              type: "string",
              description:
                "1–2 sentences explaining the mismatch in plain language.",
            },
            sheet_a: { type: "string", description: "First sheet (e.g. A-101)." },
            value_a: {
              type: "string",
              description:
                "Verbatim value/text from sheet_a (e.g. 'Door 101: 3'-0\" x 7'-0\"').",
            },
            sheet_b: { type: "string", description: "Second sheet (e.g. A-601)." },
            value_b: {
              type: "string",
              description:
                "Verbatim value/text from sheet_b that disagrees (e.g. 'Door 101 schedule: 2'-8\" x 6'-8\"').",
            },
            evidence: {
              type: "array",
              items: { type: "string" },
              description:
                "Up to 3 short verbatim snippets (≤200 chars) supporting the mismatch.",
            },
            severity: { type: "string", enum: ["high", "medium", "low"] },
            confidence_score: { type: "number", minimum: 0, maximum: 1 },
          },
          required: [
            "category",
            "description",
            "sheet_a",
            "value_a",
            "sheet_b",
            "value_b",
            "severity",
            "confidence_score",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["mismatches"],
    additionalProperties: false,
  },
} as const;

const CROSS_SHEET_SYSTEM_PROMPT = `You are a senior plan reviewer doing a CROSS-SHEET CONSISTENCY pass. The discipline reviewers already ran on individual sheets. Your job is the bug class they cannot catch alone: contradictions BETWEEN sheets in the same submittal.

Hunt for these patterns:
- Door/window schedule vs floor-plan callouts disagree on size, hardware, fire rating
- Occupant load on life-safety/code summary sheet ≠ sum of room loads on architectural
- Plumbing fixture count on plan ≠ fixture schedule ≠ riser diagram
- Electrical panel schedule kVA / breaker count ≠ riser diagram
- Structural beam/column callout on plan missing from framing/foundation schedule
- Room finish on plan ≠ finish schedule
- Egress capacity (occupant load × in/occupant) ≠ door/stair clear width provided
- Section/detail callouts on plan reference a detail number that does not exist on the referenced sheet
- Sheet index lists sheets that are not in the submittal (or vice versa)

Hard rules:
1. Quote BOTH disagreeing values verbatim. If you cannot quote both sides from the supplied sheets, do not raise it.
2. Use the EXACT sheet identifier as printed in the title block (e.g. "A-101", not "Architectural floor plan").
3. Numeric mismatches must be real disagreements, not rounding (3'-0" vs 36" is the same).
4. Skip anything already obvious from a single sheet — the discipline reviewers handle those.
5. Prefer high-impact disagreements: life-safety, egress, structural, panel sizing.
6. Return an empty array if you find nothing concrete. Do not invent.`;

async function runCrossSheetConsistency(
  admin: ReturnType<typeof createClient>,
  planReviewId: string,
): Promise<ConsistencyMismatch[]> {
  // Pull sheet roster + signed URLs in parallel.
  const [sheetsRes, signedUrls] = await Promise.all([
    admin
      .from("sheet_coverage")
      .select("sheet_ref, sheet_title, page_index")
      .eq("plan_review_id", planReviewId)
      .order("page_index", { ascending: true }),
    signedSheetUrls(admin, planReviewId),
  ]);

  const allSheets = (sheetsRes.data ?? []) as Array<{
    sheet_ref: string;
    sheet_title: string | null;
    page_index: number | null;
  }>;
  if (allSheets.length < 2 || signedUrls.length < 2) return [];

  // Cap at 8 sheets to keep the call within model limits / cost. Pick by
  // round-robin across discipline prefixes so a single-discipline-heavy set
  // (e.g. 74 A-sheets, 0 S/M/E) doesn't fill all 8 slots with one discipline
  // — the entire point of the cross-sheet pass is to find conflicts BETWEEN
  // disciplines, so an A-only payload wastes the call.
  const PRIORITY_PREFIXES = ["A", "S", "M", "P", "E", "F", "L", "G"];
  const buckets = new Map<string, typeof allSheets>();
  for (const s of allSheets) {
    const k = s.sheet_ref.trim().toUpperCase()[0] ?? "Z";
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(s);
  }
  const selected: typeof allSheets = [];
  for (let pass = 0; pass < 4 && selected.length < 8; pass++) {
    for (const k of PRIORITY_PREFIXES) {
      if (selected.length >= 8) break;
      const b = buckets.get(k);
      if (b && b[pass]) selected.push(b[pass]);
    }
  }
  // If priority prefixes didn't fill 8 slots (unlabelled sheets only),
  // top up from whatever else is in the buckets.
  if (selected.length < 8) {
    for (const [k, b] of buckets) {
      if (PRIORITY_PREFIXES.includes(k)) continue;
      for (const s of b) {
        if (selected.length >= 8) break;
        selected.push(s);
      }
      if (selected.length >= 8) break;
    }
  }
  const imageUrls = selected
    .map((s) => signedUrls[s.page_index ?? -1]?.signed_url)
    .filter(Boolean) as string[];
  if (imageUrls.length < 2) return [];

  const userText =
    `Sheets supplied (${selected.length}):\n` +
    selected
      .map(
        (s) =>
          `- ${s.sheet_ref}${s.sheet_title ? ` — ${s.sheet_title}` : ""}`,
      )
      .join("\n") +
    `\n\nFind cross-sheet mismatches per the system rules. Return JSON via the tool call.`;

  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [
    { type: "text", text: userText },
    ...imageUrls.map((u) => ({
      type: "image_url" as const,
      image_url: { url: u },
    })),
  ];

  let result: { mismatches?: Array<Omit<ConsistencyMismatch, "deficiency_id" | "def_number">> };
  try {
    result = (await callAI(
      [
        { role: "system", content: CROSS_SHEET_SYSTEM_PROMPT },
        { role: "user", content },
      ],
      CROSS_SHEET_SCHEMA as unknown as Record<string, unknown>,
    )) as typeof result;
  } catch (err) {
    console.error("[cross_sheet_consistency] AI call failed:", err);
    return [];
  }

  const raw = (result?.mismatches ?? []).filter(
    (m) =>
      m &&
      m.sheet_a &&
      m.sheet_b &&
      m.sheet_a.trim().toUpperCase() !== m.sheet_b.trim().toUpperCase() &&
      (m.value_a ?? "").trim() &&
      (m.value_b ?? "").trim(),
  );

  return raw.map((m) => ({
    category: m.category,
    description: m.description,
    sheet_a: m.sheet_a.trim().toUpperCase(),
    value_a: m.value_a.slice(0, 240),
    sheet_b: m.sheet_b.trim().toUpperCase(),
    value_b: m.value_b.slice(0, 240),
    evidence: (m.evidence ?? []).slice(0, 3).map((s) => s.slice(0, 200)),
    severity: m.severity,
    confidence_score: Math.max(0, Math.min(1, m.confidence_score ?? 0.5)),
  }));
}

async function persistConsistencyMismatches(
  admin: ReturnType<typeof createClient>,
  planReviewId: string,
  firmId: string | null,
  mismatches: ConsistencyMismatch[],
): Promise<ConsistencyMismatch[]> {
  if (mismatches.length === 0) return [];

  const { count: existingCount } = await admin
    .from("deficiencies_v2")
    .select("id", { count: "exact", head: true })
    .eq("plan_review_id", planReviewId)
    .like("def_number", "DEF-XS%");
  const baseIdx = (existingCount ?? 0) + 1;

  const rows = mismatches.map((m, i) => ({
    plan_review_id: planReviewId,
    firm_id: firmId,
    def_number: `DEF-XS${String(baseIdx + i).padStart(3, "0")}`,
    discipline: "Cross-Sheet",
    sheet_refs: [m.sheet_a, m.sheet_b],
    code_reference: {},
    finding: `Cross-sheet mismatch: ${m.description} (${m.sheet_a}: "${m.value_a}" vs ${m.sheet_b}: "${m.value_b}")`,
    required_action:
      "Reconcile the two sheets. Update the design so both references agree, then resubmit the affected sheets.",
    evidence: m.evidence,
    priority: m.severity,
    life_safety_flag:
      m.category === "occupant_load_sum" || m.category === "egress_width_vs_capacity",
    permit_blocker: m.severity === "high",
    liability_flag: false,
    requires_human_review: true,
    human_review_reason:
      "Cross-sheet consistency check — verify both quoted values exist on the cited sheets before issuing.",
    human_review_method:
      `Open ${m.sheet_a} and ${m.sheet_b}, locate the quoted values, confirm the disagreement is real (not rounding/scale).`,
    confidence_score: m.confidence_score,
    confidence_basis: "Cross-sheet vision pass",
    model_version: "google/gemini-2.5-pro",
    status: "open",
    citation_status: "unverified",
  }));

  const { data: inserted, error } = await admin
    .from("deficiencies_v2")
    .insert(rows)
    .select("id, def_number");
  if (error) {
    console.error("[cross_sheet_consistency] insert failed:", error);
    return mismatches; // surface them in metadata anyway
  }

  return mismatches.map((m, i) => ({
    ...m,
    deficiency_id: (inserted?.[i] as { id: string } | undefined)?.id,
    def_number: (inserted?.[i] as { def_number: string } | undefined)?.def_number,
  }));
}

async function stageCrossCheck(
  admin: ReturnType<typeof createClient>,
  planReviewId: string,
  firmId: string | null,
) {
  // Load all open deficiencies for this review.
  const { data: defs, error: defsErr } = await admin
    .from("deficiencies_v2")
    .select("id, def_number, finding, sheet_refs, code_reference, status")
    .eq("plan_review_id", planReviewId)
    .neq("status", "resolved")
    .neq("status", "waived");
  if (defsErr) throw defsErr;

  const rows = (defs ?? []) as Array<{
    id: string;
    def_number: string;
    finding: string;
    sheet_refs: string[] | null;
    code_reference: { section?: string } | null;
    status: string;
  }>;

  // ---------- duplicate detection ----------
  // Key: <fbc_section>|<sheet_ref>. A finding cited on N sheets fans out into
  // N keys, so duplicates across sheets are caught.
  const groupMap = new Map<string, DuplicateGroup>();
  for (const d of rows) {
    const section = (d.code_reference?.section ?? "").trim().toLowerCase();
    if (!section) continue; // can't dedupe without a code anchor
    const sheets = (d.sheet_refs ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (sheets.length === 0) continue;
    for (const sheet of sheets) {
      const key = `${section}|${sheet}`;
      const existing = groupMap.get(key);
      if (existing) {
        if (!existing.deficiency_ids.includes(d.id)) {
          existing.deficiency_ids.push(d.id);
          existing.def_numbers.push(d.def_number);
        }
      } else {
        groupMap.set(key, {
          key,
          fbc_section: section,
          sheet_ref: sheet,
          deficiency_ids: [d.id],
          def_numbers: [d.def_number],
        });
      }
    }
  }
  const duplicate_groups = Array.from(groupMap.values()).filter(
    (g) => g.deficiency_ids.length > 1,
  );

  // ---------- contradiction detection ----------
  // A finding "contradicts" prior rounds if a previous round closed the same
  // (fbc_section + sheet) issue as resolved/waived but this round reopened it.
  const { data: prevRows } = await admin
    .from("plan_reviews")
    .select("round, previous_findings")
    .eq("id", planReviewId)
    .maybeSingle();
  const prev = prevRows as
    | { round: number; previous_findings: unknown }
    | null;

  type PriorFinding = {
    fbc_section?: string;
    code_section?: string;
    code_reference?: { section?: string };
    sheet_refs?: string[];
    sheet_ref?: string;
    status?: string;
    finding?: string;
    round?: number;
  };

  const priorList: PriorFinding[] = Array.isArray(prev?.previous_findings)
    ? (prev!.previous_findings as PriorFinding[])
    : [];

  const priorIndex = new Map<string, PriorFinding>();
  for (const p of priorList) {
    const sec = (
      p.fbc_section ??
      p.code_section ??
      p.code_reference?.section ??
      ""
    )
      .trim()
      .toLowerCase();
    if (!sec) continue;
    const sheets = (p.sheet_refs ?? (p.sheet_ref ? [p.sheet_ref] : []))
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const wasClosed = p.status === "resolved" || p.status === "waived";
    if (!wasClosed) continue;
    for (const sheet of sheets) {
      priorIndex.set(`${sec}|${sheet}`, p);
    }
  }

  const contradictions: Contradiction[] = [];
  for (const d of rows) {
    const sec = (d.code_reference?.section ?? "").trim().toLowerCase();
    if (!sec) continue;
    const sheets = (d.sheet_refs ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean);
    for (const sheet of sheets) {
      const hit = priorIndex.get(`${sec}|${sheet}`);
      if (hit) {
        contradictions.push({
          deficiency_id: d.id,
          def_number: d.def_number,
          finding: d.finding,
          prior_round: hit.round ?? (prev?.round ?? 1) - 1,
          prior_status: hit.status ?? "resolved",
          prior_finding: hit.finding ?? "(prior finding)",
          reason: `FBC ${sec} on ${sheet} was previously ${hit.status} in round ${hit.round ?? "prior"}.`,
        });
        break; // one record per deficiency
      }
    }
  }

  // ---------- cross-sheet consistency (AI vision pass) ----------
  let consistency_mismatches: ConsistencyMismatch[] = [];
  try {
    const raw = await runCrossSheetConsistency(admin, planReviewId);
    consistency_mismatches = await persistConsistencyMismatches(
      admin,
      planReviewId,
      firmId,
      raw,
    );
  } catch (err) {
    console.error("[cross_check] consistency pass failed:", err);
  }

  return {
    duplicate_groups,
    duplicates_found: duplicate_groups.length,
    contradictions,
    contradictions_found: contradictions.length,
    consistency_mismatches,
    consistency_mismatches_found: consistency_mismatches.length,
  };
}

const DEFERRED_SCOPE_SCHEMA = {
  name: "submit_deferred_scope",
  description:
    "Identify deferred-submittal items called out on the plan set. Only return items the plans explicitly defer to a separate submittal package (e.g. 'fire sprinkler shop drawings under separate permit', 'pre-engineered trusses by manufacturer'). Do not invent items.",
  parameters: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            category: {
              type: "string",
              enum: [
                "fire_sprinkler",
                "fire_alarm",
                "pre_engineered_metal_building",
                "truss_shop_drawings",
                "elevators",
                "kitchen_hood",
                "stair_pressurization",
                "smoke_control",
                "curtain_wall",
                "storefront_glazing",
                "other",
              ],
            },
            description: {
              type: "string",
              description: "Plain-language summary of what is deferred.",
            },
            sheet_refs: {
              type: "array",
              items: { type: "string" },
              description: "Sheet(s) where the callout appears (e.g. G-001).",
            },
            evidence: {
              type: "array",
              items: { type: "string" },
              description: "Verbatim text from the plans (≤200 chars, max 3).",
            },
            required_submittal: {
              type: "string",
              description:
                "What submittal package the design team must provide before permit/installation.",
            },
            responsible_party: {
              type: "string",
              description: "Who provides it (e.g. 'Fire sprinkler subcontractor').",
            },
            confidence_score: { type: "number", minimum: 0, maximum: 1 },
          },
          required: [
            "category",
            "description",
            "sheet_refs",
            "evidence",
            "confidence_score",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  },
} as const;

async function stageDeferredScope(
  admin: ReturnType<typeof createClient>,
  planReviewId: string,
  firmId: string | null,
) {
  // Idempotent — skip if already populated this run.
  const { count: existing } = await admin
    .from("deferred_scope_items")
    .select("id", { count: "exact", head: true })
    .eq("plan_review_id", planReviewId);
  if ((existing ?? 0) > 0) {
    return { reused: true, deferred_items: existing };
  }

  // Pull the general/cover sheets — that's where deferred-submittal lists
  // almost always live. Fall back to first 3 pages if no general sheets mapped.
  const [{ data: generalSheets }, signed] = await Promise.all([
    admin
      .from("sheet_coverage")
      .select("page_index, sheet_ref")
      .eq("plan_review_id", planReviewId)
      .eq("status", "present")
      .in("discipline", ["General"])
      .order("page_index", { ascending: true })
      .limit(4),
    signedSheetUrls(admin, planReviewId),
  ]);

  let imageUrls: string[] = [];
  let sourceSheetRefs: string[] = [];
  const general = (generalSheets ?? []) as Array<{
    page_index: number | null;
    sheet_ref: string;
  }>;
  if (general.length > 0) {
    imageUrls = general
      .map((s) => signed[s.page_index ?? -1]?.signed_url)
      .filter(Boolean) as string[];
    sourceSheetRefs = general.map((s) => s.sheet_ref);
  }
  if (imageUrls.length === 0) {
    imageUrls = signed.slice(0, 3).map((s) => s.signed_url);
  }
  if (imageUrls.length === 0) {
    return { deferred_items: 0, reason: "no_images" };
  }

  const userText =
    `Read the cover / general-notes pages of a Florida construction document set ` +
    `and identify any items the plans explicitly defer to a separate submittal package. ` +
    `Common candidates: fire sprinkler, fire alarm, pre-engineered metal building, ` +
    `truss shop drawings, elevators, kitchen hood, stair pressurization, smoke control, ` +
    `curtain wall / storefront glazing. Only return items the plans actually call out as deferred. ` +
    `For each item, cite the verbatim text snippet and the sheet it appears on. ` +
    `If nothing is deferred, return an empty items array.\n\n` +
    `Sheets supplied (in order): ${sourceSheetRefs.join(", ") || "(unmapped)"}`;

  let extracted: { items: Array<Record<string, unknown>> } = { items: [] };
  try {
    extracted = (await callAI(
      [
        {
          role: "system",
          content:
            "You are a Florida private-provider plan reviewer cataloguing deferred submittals. Read the plans verbatim. Never invent deferred items.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            ...imageUrls.map((u) => ({
              type: "image_url" as const,
              image_url: { url: u },
            })),
          ],
        },
      ],
      DEFERRED_SCOPE_SCHEMA as unknown as Record<string, unknown>,
      "google/gemini-2.5-flash",
    )) as { items: Array<Record<string, unknown>> };
  } catch (err) {
    console.error("[deferred_scope] vision call failed:", err);
    return { deferred_items: 0, error: err instanceof Error ? err.message : String(err) };
  }

  const items = extracted.items ?? [];
  if (items.length === 0) return { deferred_items: 0 };

  const rows = items.map((it) => ({
    plan_review_id: planReviewId,
    firm_id: firmId,
    category: String(it.category ?? "other"),
    description: String(it.description ?? "").slice(0, 1000),
    sheet_refs: Array.isArray(it.sheet_refs)
      ? (it.sheet_refs as string[]).slice(0, 8).map((s) => String(s).toUpperCase().slice(0, 32))
      : [],
    evidence: Array.isArray(it.evidence)
      ? (it.evidence as string[]).slice(0, 3).map((s) => String(s).slice(0, 200))
      : [],
    required_submittal: String(it.required_submittal ?? "").slice(0, 500),
    responsible_party: String(it.responsible_party ?? "").slice(0, 200),
    confidence_score: typeof it.confidence_score === "number"
      ? Math.max(0, Math.min(1, it.confidence_score))
      : 0.5,
    status: "pending",
  }));

  const { error } = await admin.from("deferred_scope_items").insert(rows);
  if (error) throw error;
  return { deferred_items: rows.length };
}

async function stagePrioritize(
  admin: ReturnType<typeof createClient>,
  planReviewId: string,
) {
  // Sort by life_safety > permit_blocker > liability > priority. We don't
  // mutate ordering in DB (it's done at render time), but we can flip
  // priority='high' for any deficiency tagged life_safety_flag or permit_blocker
  // that is still 'medium'.
  const { data } = await admin
    .from("deficiencies_v2")
    .select("id, priority, life_safety_flag, permit_blocker")
    .eq("plan_review_id", planReviewId);

  if (!data) return { promoted: 0 };
  const promotions = data.filter(
    (d: { priority: string; life_safety_flag: boolean; permit_blocker: boolean }) =>
      (d.life_safety_flag || d.permit_blocker) && d.priority !== "high",
  );
  for (const p of promotions) {
    await admin
      .from("deficiencies_v2")
      .update({ priority: "high" })
      .eq("id", (p as { id: string }).id);
  }
  return { promoted: promotions.length };
}

async function stageComplete(
  admin: ReturnType<typeof createClient>,
  planReviewId: string,
) {
  // Snapshot the current sheet_map into checklist_state.last_sheet_map so the
  // NEXT round's discipline_review can diff against it and skip unchanged
  // sheets. We persist (sheet_ref, page_index, discipline) — enough to detect
  // structural changes without bloating the JSONB column.
  const { data: sheetRows } = await admin
    .from("sheet_coverage")
    .select("sheet_ref, page_index, discipline")
    .eq("plan_review_id", planReviewId);
  const snapshot = (sheetRows ?? []) as Array<{
    sheet_ref: string;
    page_index: number | null;
    discipline: string | null;
  }>;

  const { data: existing } = await admin
    .from("plan_reviews")
    .select("checklist_state")
    .eq("id", planReviewId)
    .maybeSingle();
  const prevState = ((existing?.checklist_state ?? {}) as Record<string, unknown>) ?? {};

  await admin
    .from("plan_reviews")
    .update({
      ai_check_status: "complete",
      pipeline_version: "v2",
      checklist_state: {
        ...prevState,
        last_sheet_map: snapshot,
        last_sheet_map_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", planReviewId);
  return { ok: true, snapshot_size: snapshot.length };
}

// ---------- adversarial verification ----------

const VERIFY_SCHEMA = {
  name: "submit_verifications",
  description:
    "For each finding supplied, return a verdict from a senior plans examiner challenging the original examiner's conclusion. Use 'cannot_locate' if the cited element/area on the cited sheet is not visible to you in the supplied images — never auto-overturn for that reason; route to human review instead.",
  parameters: {
    type: "object",
    properties: {
      verifications: {
        type: "array",
        items: {
          type: "object",
          properties: {
            deficiency_id: { type: "string" },
            verdict: {
              type: "string",
              enum: ["upheld", "overturned", "modified", "cannot_locate"],
            },
            reasoning: {
              type: "string",
              description:
                "Why upheld/overturned/modified/cannot_locate. For 'cannot_locate' explain what you searched for and where you couldn't find it.",
            },
            corrected_finding: {
              type: "string",
              description: "If verdict='modified', the corrected finding text.",
            },
            corrected_required_action: {
              type: "string",
              description: "If verdict='modified', the corrected required action.",
            },
          },
          required: ["deficiency_id", "verdict", "reasoning"],
          additionalProperties: false,
        },
      },
    },
    required: ["verifications"],
    additionalProperties: false,
  },
} as const;

interface VerifyTarget {
  id: string;
  def_number: string;
  discipline: string;
  finding: string;
  required_action: string;
  evidence: string[];
  sheet_refs: string[];
  code_reference: { code?: string; section?: string; edition?: string } | null;
  confidence_score: number | null;
  confidence_basis: string | null;
  priority: string;
  page_indices: number[];
}

async function stageVerify(
  admin: ReturnType<typeof createClient>,
  planReviewId: string,
) {
  // Pull candidates: low-confidence (<0.85) OR high-priority (life safety / permit blocker / priority='high').
  const { data: defsRaw, error } = await admin
    .from("deficiencies_v2")
    .select(
      "id, def_number, discipline, finding, required_action, evidence, sheet_refs, code_reference, confidence_score, confidence_basis, priority, life_safety_flag, permit_blocker, status, verification_status",
    )
    .eq("plan_review_id", planReviewId)
    .neq("status", "resolved")
    .neq("status", "waived")
    .eq("verification_status", "unverified");
  if (error) throw error;

  const candidates = ((defsRaw ?? []) as Array<{
    id: string;
    def_number: string;
    discipline: string;
    finding: string;
    required_action: string;
    evidence: string[] | null;
    sheet_refs: string[] | null;
    code_reference: { code?: string; section?: string; edition?: string } | null;
    confidence_score: number | null;
    confidence_basis: string | null;
    priority: string;
    life_safety_flag: boolean;
    permit_blocker: boolean;
  }>).filter((d) => {
    const lowConf = (d.confidence_score ?? 1) < 0.85;
    const highPri =
      d.priority === "high" || d.life_safety_flag || d.permit_blocker;
    return lowConf || highPri;
  });

  if (candidates.length === 0) {
    return { upheld: 0, overturned: 0, modified: 0, cannot_locate: 0, examined: 0, skipped: 0 };
  }

  // Map sheet_refs → page_index so we can attach the right images per finding.
  const { data: coverageRows } = await admin
    .from("sheet_coverage")
    .select("sheet_ref, page_index")
    .eq("plan_review_id", planReviewId);
  const refToPage = new Map<string, number>();
  for (const r of (coverageRows ?? []) as Array<{
    sheet_ref: string;
    page_index: number | null;
  }>) {
    if (r.page_index !== null && r.page_index !== undefined) {
      refToPage.set(r.sheet_ref.toUpperCase(), r.page_index);
    }
  }

  const signed = await signedSheetUrls(admin, planReviewId);

  const targets: VerifyTarget[] = candidates.map((d) => ({
    id: d.id,
    def_number: d.def_number,
    discipline: d.discipline,
    finding: d.finding,
    required_action: d.required_action,
    evidence: d.evidence ?? [],
    sheet_refs: d.sheet_refs ?? [],
    code_reference: d.code_reference,
    confidence_score: d.confidence_score,
    confidence_basis: d.confidence_basis,
    priority: d.priority,
    page_indices: Array.from(
      new Set(
        (d.sheet_refs ?? [])
          .map((s) => refToPage.get(s.toUpperCase()))
          .filter((n): n is number => typeof n === "number"),
      ),
    ).slice(0, 3),
  }));

  const VERIFY_SYSTEM =
    "You are a senior Florida plans examiner adversarially auditing another examiner's findings. " +
    "For each finding, you receive: the finding text, the cited code reference, the verbatim evidence the original examiner read off the sheet, their confidence basis, and the actual cited sheet image(s). " +
    "Your job is to find reasons the finding might be WRONG — but you MUST distinguish between two failure modes:\n" +
    "  (a) The finding is demonstrably incorrect — the plans clearly comply, the cited code does not apply, or the cited evidence is misquoted/out of context. → 'overturned'.\n" +
    "  (b) You cannot locate the cited element/area on the supplied sheets, or the resolution/crop is insufficient to verify. → 'cannot_locate'. NEVER overturn for that reason.\n" +
    "Return verdicts via submit_verifications:\n" +
    "- 'upheld' — finding is valid as written; cite the visible evidence that supports it.\n" +
    "- 'overturned' — finding is provably wrong; cite the conflicting visible evidence.\n" +
    "- 'modified' — finding is partially right but mis-stated; provide corrected_finding + corrected_required_action.\n" +
    "- 'cannot_locate' — you cannot verify either way from the supplied images. Will be routed to human review.\n" +
    "Be strict: 'overturned' requires positive evidence the finding is wrong, not absence of evidence.";

  // Smaller batch reduces per-request image payload (was 5 → OOM risk on big sets).
  const BATCH = 3;
  let upheld = 0;
  let overturned = 0;
  let modified = 0;
  let cannotLocate = 0;
  let skipped = 0;

  for (let start = 0; start < targets.length; start += BATCH) {
    const slice = targets.slice(start, start + BATCH);

    // Aggregate page indices across the batch. Cap at 8 (matches
    // DISCIPLINE_BATCH payload size) so multi-sheet findings cited on 4-6
    // sheets aren't silently truncated to the first 5.
    const pageSet = new Set<number>();
    for (const t of slice) for (const p of t.page_indices) pageSet.add(p);
    const pages = Array.from(pageSet).slice(0, Math.min(8, pageSet.size));
    const imageUrls = pages
      .map((p) => signed[p]?.signed_url)
      .filter(Boolean) as string[];

    const findingsText = slice
      .map((t) => {
        const code = t.code_reference
          ? [t.code_reference.code, t.code_reference.section, t.code_reference.edition]
              .filter(Boolean)
              .join(" ")
          : "(no code cited)";
        return (
          `--- deficiency_id: ${t.id}\n` +
          `def_number: ${t.def_number} (${t.discipline})\n` +
          `priority: ${t.priority}, original confidence: ${t.confidence_score ?? "?"}\n` +
          `sheet_refs: ${t.sheet_refs.join(", ") || "(none)"}\n` +
          `code_reference: ${code}\n` +
          `finding: ${t.finding}\n` +
          `required_action: ${t.required_action}\n` +
          `original_examiner_evidence: ${t.evidence.length ? t.evidence.map((e) => `"${e}"`).join(" | ") : "(NONE — examiner had no quoted evidence; treat with extra skepticism)"}\n` +
          `original_confidence_basis: ${t.confidence_basis ?? "(not provided)"}`
        );
      })
      .join("\n\n");

    const userText =
      `Audit the following ${slice.length} finding${slice.length === 1 ? "" : "s"}. ` +
      `For EACH deficiency_id, return one entry in submit_verifications. ` +
      `When you cannot find the cited element on the supplied sheet images, return 'cannot_locate' — do NOT overturn.\n\n` +
      `${findingsText}\n\n` +
      `The attached images are the cited sheets (in the order listed above). ` +
      `Each sheet has a 10×10 grid overlay (cells A0..J9) you can use to describe locations.`;

    const content: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    > = [
      { type: "text", text: userText },
      ...imageUrls.map((u) => ({
        type: "image_url" as const,
        image_url: { url: u },
      })),
    ];

    let result: {
      verifications: Array<{
        deficiency_id: string;
        verdict: "upheld" | "overturned" | "modified" | "cannot_locate";
        reasoning: string;
        corrected_finding?: string;
        corrected_required_action?: string;
      }>;
    };
    try {
      result = (await callAI(
        [
          { role: "system", content: VERIFY_SYSTEM },
          { role: "user", content },
        ],
        VERIFY_SCHEMA as unknown as Record<string, unknown>,
      )) as typeof result;
    } catch (err) {
      console.error(`[verify] batch ${start} failed:`, err);
      skipped += slice.length;
      continue;
    }

    const byId = new Map(slice.map((t) => [t.id, t] as const));
    for (const v of result.verifications ?? []) {
      const target = byId.get(v.deficiency_id);
      if (!target) continue;
      const reasoning = (v.reasoning ?? "").slice(0, 1000);

      if (v.verdict === "overturned") {
        await admin
          .from("deficiencies_v2")
          .update({
            verification_status: "overturned",
            verification_notes: reasoning,
            status: "waived",
            reviewer_disposition: "reject",
            reviewer_notes: `Overturned in adversarial verification: ${reasoning}`,
          })
          .eq("id", target.id);
        overturned++;
      } else if (v.verdict === "modified") {
        const patch: Record<string, unknown> = {
          verification_status: "modified",
          verification_notes: reasoning,
          requires_human_review: true,
          human_review_reason:
            target.confidence_score !== null && target.confidence_score < 0.7
              ? "Modified during adversarial verification — please confirm before sending."
              : "Verification AI modified this finding — please confirm.",
        };
        if (v.corrected_finding) patch.finding = v.corrected_finding.slice(0, 1000);
        if (v.corrected_required_action) {
          patch.required_action = v.corrected_required_action.slice(0, 1000);
        }
        await admin.from("deficiencies_v2").update(patch).eq("id", target.id);
        modified++;
      } else if (v.verdict === "cannot_locate") {
        // Verifier could not find the cited element on the supplied images.
        // Don't overturn — route to a human with full context so they can
        // either confirm with the original sheet, request a clearer crop,
        // or reject manually.
        await admin
          .from("deficiencies_v2")
          .update({
            verification_status: "needs_human",
            verification_notes: reasoning,
            requires_human_review: true,
            human_review_reason:
              "Senior verifier could not locate the cited element on the supplied sheet images.",
            human_review_method:
              "Open the cited sheet at full resolution and confirm presence/absence of the element described.",
            human_review_verify: reasoning.slice(0, 500),
          })
          .eq("id", target.id);
        cannotLocate++;
      } else {
        const newConf = Math.max(
          0,
          Math.min(1, (target.confidence_score ?? 0.5) + 0.1),
        );
        await admin
          .from("deficiencies_v2")
          .update({
            verification_status: "verified",
            verification_notes: reasoning,
            confidence_score: newConf,
          })
          .eq("id", target.id);
        upheld++;
      }
    }
  }

  return {
    examined: targets.length,
    upheld,
    overturned,
    modified,
    cannot_locate: cannotLocate,
    skipped,
  };
}

// ---------- dedupe ----------
//
// Cross-discipline deduplication. The discipline_review stage runs Architectural,
// Life Safety, Fire Protection, MEP, etc. in parallel and the same real-world
// issue (egress sign location, fire-rated wall, ADA clearance, sprinkler head
// spacing) often surfaces 2–3 times under different disciplines.
//
// Strategy:
//   1. Bucket live findings by normalized FBC section + overlapping sheet refs.
//   2. Within each bucket, group findings whose `finding` text overlaps >= 0.55
//      by token-set Jaccard. Single-finding groups are kept as-is.
//   3. Pick a winner per group:
//        - prefer non-overturned, non-superseded
//        - then the discipline that "owns" the cited code (Life Safety owns
//          1010.x egress, Fire Protection owns 903.x sprinklers, etc.)
//        - then highest confidence_score
//        - then most evidence quotes
//   4. Mark losers `verification_status = 'superseded'`, `status = 'waived'`,
//      and prepend a verification_notes line pointing at the winner so the
//      audit trail is intact and reviewers can spot-check.

const STOP_WORDS = new Set([
  "the","a","an","and","or","of","to","in","on","at","is","are","be","with","for",
  "by","from","this","that","these","those","not","no","as","it","its","has","have",
  "must","shall","should","provide","provided","required","missing","per","cited",
  "see","sheet","sheets","plan","plans","drawings","drawing","detail","section",
  "code","fbc","florida","building","compliance","comply","review","reviewer",
]);

function tokenSet(text: string): Set<string> {
  return new Set(
    (text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOP_WORDS.has(t)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Normalize an FBC section ref so "1010.1.1", "FBC 1010.1.1", "1010.01.01" all collapse. */
function normSection(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .toLowerCase()
    .replace(/fbc|florida\s+building\s+code|building\s+code/g, "")
    .replace(/[^0-9.]/g, "")
    .replace(/\.0+(\d)/g, ".$1")
    .replace(/^\.+|\.+$/g, "")
    .trim();
}

/**
 * Discipline that "owns" a given FBC chapter/section. Used as a tie-breaker
 * when the same code is flagged by multiple disciplines.
 */
function ownerDiscipline(section: string): string | null {
  if (!section) return null;
  const chapter = parseInt(section.split(".")[0] || "0", 10);
  if (isNaN(chapter)) return null;
  // FBC Building chapters
  if (chapter === 10) return "Life Safety"; // egress
  if (chapter === 11) return "Accessibility"; // accessibility
  if (chapter === 9) return "Fire Protection"; // fire protection systems
  if (chapter === 7) return "Architectural"; // fire- and smoke-rated assemblies
  if (chapter >= 16 && chapter <= 23) return "Structural"; // structural
  if (chapter >= 28 && chapter <= 30) return "MEP"; // mechanical/plumbing/elevators
  return null;
}

interface DedupeWinnerPick {
  winner: string; // deficiency id
  losers: string[]; // deficiency ids
  reason: string;
}

interface DedupeRow {
  id: string;
  def_number: string;
  discipline: string;
  finding: string;
  sheet_refs: string[] | null;
  code_reference: { section?: string } | null;
  evidence: string[] | null;
  confidence_score: number | null;
  verification_status: string;
  status: string;
}

async function stageDedupe(
  admin: ReturnType<typeof createClient>,
  planReviewId: string,
) {
  const { data: defsRaw, error } = await admin
    .from("deficiencies_v2")
    .select(
      "id, def_number, discipline, finding, sheet_refs, code_reference, evidence, confidence_score, verification_status, status",
    )
    .eq("plan_review_id", planReviewId)
    .neq("status", "resolved")
    .neq("status", "waived")
    .neq("verification_status", "overturned")
    .neq("verification_status", "superseded");
  if (error) throw error;

  const rows = (defsRaw ?? []) as DedupeRow[];
  if (rows.length < 2) {
    return { examined: rows.length, groups_merged: 0, findings_superseded: 0 };
  }

  // Pre-compute normalized section, sheet set, token set per row.
  const enriched = rows.map((d) => {
    const section = normSection(d.code_reference?.section);
    const sheets = new Set(
      (d.sheet_refs ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean),
    );
    const tokens = tokenSet(d.finding);
    return { row: d, section, sheets, tokens };
  });

  // Bucket by **parent** FBC section (first two dotted levels) so that
  // 508, 508.4, and 508.4.1 all end up in the same bucket and the in-bucket
  // similarity check can decide whether to merge them. Findings with no
  // section get bucketed by (discipline, first sheet ref) so same-discipline
  // same-sheet duplicates (e.g. eight variants of "cover sheet missing code
  // summary" all on G001/Architectural) still cluster.
  function bucketKey(e: { section: string; sheets: Set<string>; row: DedupeRow }): string | null {
    if (e.section) {
      const parts = e.section.split(".");
      // Chapter + first sub-level. "508.4.1" → "sec:508.4". "508" → "sec:508".
      const parent = parts.slice(0, Math.min(2, parts.length)).join(".");
      return `sec:${parent}`;
    }
    if (e.sheets.size > 0) {
      // Sort to keep the bucket key stable regardless of sheet_refs order.
      const firstSheet = [...e.sheets].sort()[0];
      return `sheet:${e.row.discipline}:${firstSheet}`;
    }
    return null;
  }
  const buckets = new Map<string, typeof enriched>();
  for (const e of enriched) {
    const key = bucketKey(e);
    if (!key) continue;
    const arr = buckets.get(key) ?? [];
    arr.push(e);
    buckets.set(key, arr);
  }

  const merges: DedupeWinnerPick[] = [];

  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;

    // Within a bucket, build groups via single-link clustering on:
    //  - any sheet overlap, AND
    //  - finding-text Jaccard >= 0.55
    const visited = new Set<number>();
    for (let i = 0; i < bucket.length; i++) {
      if (visited.has(i)) continue;
      const group: number[] = [i];
      visited.add(i);
      for (let j = i + 1; j < bucket.length; j++) {
        if (visited.has(j)) continue;
        const a = bucket[i];
        const b = bucket[j];
        // Sheet overlap (or both have no sheets — already same bucket key).
        const sheetOverlap =
          a.sheets.size === 0 ||
          b.sheets.size === 0 ||
          [...a.sheets].some((s) => b.sheets.has(s));
        if (!sheetOverlap) continue;
        // Lowered same-discipline threshold from 0.55 → 0.45 so the eight
        // variants of "cover sheet missing code summary" cluster instead of
        // looking like eight unique findings (they share `cover`, `sheet`,
        // `code`, `summary`, `missing` but each cites a different sub-section
        // and adds 2-3 unique words).
        const threshold = a.row.discipline === b.row.discipline ? 0.45 : 0.35;
        if (jaccard(a.tokens, b.tokens) < threshold) continue;
        group.push(j);
        visited.add(j);
      }
      if (group.length < 2) continue;

      // Pick winner.
      const candidates = group.map((idx) => bucket[idx]);
      const owner = ownerDiscipline(candidates[0].section);
      candidates.sort((a, b) => {
        // 1. owner-discipline match wins
        const aOwn = owner && a.row.discipline === owner ? 1 : 0;
        const bOwn = owner && b.row.discipline === owner ? 1 : 0;
        if (aOwn !== bOwn) return bOwn - aOwn;
        // 2. higher confidence wins
        const ac = a.row.confidence_score ?? 0;
        const bc = b.row.confidence_score ?? 0;
        if (ac !== bc) return bc - ac;
        // 3. more evidence wins
        const ae = (a.row.evidence ?? []).length;
        const be = (b.row.evidence ?? []).length;
        if (ae !== be) return be - ae;
        // 4. lower def_number (earlier finding) wins for stability
        return a.row.def_number.localeCompare(b.row.def_number, undefined, {
          numeric: true,
        });
      });
      const winner = candidates[0];
      const losers = candidates.slice(1);
      merges.push({
        winner: winner.row.id,
        losers: losers.map((l) => l.row.id),
        reason: `Same issue (FBC ${winner.section || "—"}) flagged by ${candidates
          .map((c) => c.row.discipline)
          .filter((v, i, arr) => arr.indexOf(v) === i)
          .join(" + ")}; kept ${winner.row.def_number} (${winner.row.discipline}).`,
      });
    }
  }

  if (merges.length === 0) {
    return { examined: rows.length, groups_merged: 0, findings_superseded: 0 };
  }

  // Apply: mark losers superseded + waived, prepend a note pointing at winner.
  let supersededCount = 0;
  for (const m of merges) {
    const winnerRow = rows.find((r) => r.id === m.winner);
    const winnerLabel = winnerRow ? `${winnerRow.def_number} (${winnerRow.discipline})` : m.winner;
    for (const loserId of m.losers) {
      const loser = rows.find((r) => r.id === loserId);
      const priorNote = loser?.verification_status && loser.verification_status !== "unverified"
        ? ` Prior verification: ${loser.verification_status}.`
        : "";
      const note = `Merged into ${winnerLabel} during cross-discipline dedupe. ${m.reason}${priorNote}`;
      const { error: updErr } = await admin
        .from("deficiencies_v2")
        .update({
          verification_status: "superseded",
          verification_notes: note.slice(0, 1000),
          status: "waived",
          reviewer_disposition: "reject",
          reviewer_notes: `Auto-merged: duplicate of ${winnerLabel}. Flip status back to 'open' if this was wrong.`,
        })
        .eq("id", loserId);
      if (!updErr) supersededCount++;
    }
  }

  return {
    examined: rows.length,
    groups_merged: merges.length,
    findings_superseded: supersededCount,
    merges: merges.map((m) => {
      const winnerRow = rows.find((r) => r.id === m.winner);
      return {
        winner: m.winner,
        winner_def_number: winnerRow?.def_number ?? null,
        winner_discipline: winnerRow?.discipline ?? null,
        winner_confidence: winnerRow?.confidence_score ?? null,
        loser_ids: m.losers,
        loser_count: m.losers.length,
        reason: m.reason,
      };
    }),
  };
}

// ---------- citation grounding ----------

/**
 * Normalize a code-section identifier for canonical lookup.
 * "1006.2.1 " → "1006.2.1", "Sec. 1010.1.9" → "1010.1.9", "R602.10" → "R602.10"
 */
function normalizeCitationSection(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw
    .replace(/sec(?:tion)?\.?/i, "")
    .replace(/[§¶]/g, "")
    .trim()
    .match(/[A-Z]?\d+(?:\.\d+)*[a-z]?/i);
  return m ? m[0].toUpperCase() : null;
}

/** Cheap token overlap (Jaccard) for "does the AI's text resemble the canonical requirement?". */
function citationOverlapScore(aiText: string, canonical: string): number {
  const tok = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3),
    );
  const a = tok(aiText);
  const b = tok(canonical);
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

type GroundingRow = {
  id: string;
  finding: string;
  required_action: string;
  code_reference:
    | { code?: string | null; section?: string | null; edition?: string | null }
    | null;
};

async function stageGroundCitations(
  admin: ReturnType<typeof createClient>,
  planReviewId: string,
) {
  // Pull every active finding (skip already-superseded/resolved/waived).
  const { data: defsRaw, error } = await admin
    .from("deficiencies_v2")
    .select("id, finding, required_action, code_reference")
    .eq("plan_review_id", planReviewId)
    .neq("status", "resolved")
    .neq("status", "waived")
    .neq("verification_status", "superseded");
  if (error) throw error;

  const defs = (defsRaw ?? []) as GroundingRow[];
  if (defs.length === 0) {
    return { examined: 0, verified: 0, mismatch: 0, not_found: 0, hallucinated: 0 };
  }

  // Collect distinct (code, section, edition) tuples and resolve all at once.
  type Key = { code: string; section: string; edition: string | null };
  const keyOf = (r: GroundingRow): Key | null => {
    const section = normalizeCitationSection(r.code_reference?.section);
    if (!section) return null;
    const code = (r.code_reference?.code || "FBC").toUpperCase();
    const edition = r.code_reference?.edition?.trim() || null;
    return { code, section, edition };
  };

  // Build a search set that includes every parent of every cited section so
  // a finding citing 508.4.1 can fall back to 508.4 → 508 if the deeper
  // sub-section isn't in our reference library (which is the common case —
  // we seed canonical text at chapter granularity, not at every leaf).
  function parentSections(s: string): string[] {
    const parts = s.split(".");
    const out: string[] = [];
    for (let i = parts.length; i >= 1; i--) out.push(parts.slice(0, i).join("."));
    return out;
  }
  const distinctSections = Array.from(
    new Set(
      defs
        .map((d) => keyOf(d))
        .filter((k): k is Key => !!k)
        .flatMap((k) => parentSections(k.section)),
    ),
  );

  // Single bulk lookup; we filter in-memory to keep round-trips cheap.
  const { data: canonRaw, error: canonErr } =
    distinctSections.length > 0
      ? await admin
          .from("fbc_code_sections")
          .select("code, section, edition, title, requirement_text")
          .in("section", distinctSections)
      : { data: [], error: null };
  if (canonErr) throw canonErr;

  type Canon = {
    code: string;
    section: string;
    edition: string;
    title: string;
    requirement_text: string;
  };
  const canon = (canonRaw ?? []) as Canon[];

  function lookup(k: Key): { hit: Canon; matchedSection: string } | null {
    // Try the cited section first, then walk up the dotted parent chain
    // (508.4.1 → 508.4 → 508). Within each level: exact (code+section+edition)
    // → exact (code+section) → section-only.
    for (const section of parentSections(k.section)) {
      let hit =
        (k.edition &&
          canon.find(
            (c) =>
              c.code === k.code && c.section === section && c.edition === k.edition,
          )) ||
        null;
      if (!hit) hit = canon.find((c) => c.code === k.code && c.section === section) ?? null;
      if (!hit) hit = canon.find((c) => c.section === section) ?? null;
      if (hit) return { hit, matchedSection: section };
    }
    return null;
  }

  const counts = { verified: 0, mismatch: 0, not_found: 0, hallucinated: 0 };
  const now = new Date().toISOString();

  for (const def of defs) {
    const key = keyOf(def);
    let status: "verified" | "mismatch" | "not_found" | "hallucinated";
    let score: number | null = null;
    let canonText: string | null = null;
    let matchedSection: string | null = null;

    if (!key) {
      // No parseable section at all = hallucinated/missing citation.
      status = "hallucinated";
    } else {
      const found = lookup(key);
      if (!found) {
        status = "not_found";
      } else {
        const { hit, matchedSection: ms } = found;
        matchedSection = ms;
        canonText = `${hit.code} ${hit.section} (${hit.edition}) — ${hit.title}: ${hit.requirement_text}`.slice(
          0,
          1500,
        );
        const aiBlob = `${def.finding} ${def.required_action}`;
        score = citationOverlapScore(aiBlob, hit.requirement_text);
        // Tightened from 0.18 → 0.30: at 0.18 a finding only needed to share
        // ~3 common words with the canonical text to "verify". For parent
        // matches (we fell back from 508.4.1 to 508), accept any match —
        // the reviewer can still see the AI cited a real section family.
        const aiBlobLc = aiBlob.toLowerCase();
        const sectionLc = ms.toLowerCase();
        const mentionsSection = aiBlobLc.includes(sectionLc) ||
          aiBlobLc.includes(key.section.toLowerCase());
        const usedParent = ms !== key.section;
        if (usedParent && mentionsSection) {
          // Parent match with the AI quoting the deeper section — acceptable.
          status = "verified";
        } else {
          status = score >= 0.30 && mentionsSection ? "verified" : "mismatch";
        }
      }
    }
    counts[status]++;

    // Only escalate to human review for true conflicts (mismatch or
    // hallucinated citations). `not_found` means our canonical library
    // doesn't carry that section yet — that's a library gap, not a finding
    // problem, and shouldn't drown the reviewer in 38/40 "needs review" pills.
    const needsHumanReview = status === "mismatch" || status === "hallucinated";
    const update: Record<string, unknown> = {
      citation_status: status,
      citation_match_score: score,
      citation_canonical_text: canonText,
      citation_grounded_at: now,
    };
    if (matchedSection && matchedSection !== key?.section) {
      // Record which parent section satisfied the lookup so the UI can
      // show "verified against 508 (cited 508.4.1)" instead of just "verified".
      update.evidence_crop_meta = { matched_parent_section: matchedSection };
    }
    if (needsHumanReview) {
      update.requires_human_review = true;
      update.human_review_reason =
        status === "mismatch"
          ? `Citation ${def.code_reference?.section ?? "?"} doesn't match the canonical FBC text — verify the section is correct.`
          : `No FBC section parseable from this finding — add or correct the citation.`;
    }
    const { error: updErr } = await admin
      .from("deficiencies_v2")
      .update(update)
      .eq("id", def.id);
    if (updErr) console.error("[ground_citations] update failed", def.id, updErr);
  }

  // After grounding, attach a one-click visual receipt to every finding so
  // reviewers don't have to mentally jump from "DEF-A012, sheet A-201" to
  // the PDF and search. Cheap: reuse the already-signed page asset URL
  // for the finding's first sheet ref. Bbox cropping can come later.
  const cropResult = await attachEvidenceCrops(admin, planReviewId);

  return {
    examined: defs.length,
    verified: counts.verified,
    mismatch: counts.mismatch,
    not_found: counts.not_found,
    hallucinated: counts.hallucinated,
    crops_attached: cropResult.attached,
    crops_skipped: cropResult.skipped,
    crops_unresolved_sheets: cropResult.unresolved_sheets,
  };
}

// ---------- evidence crops ----------
//
// For each finding, set evidence_crop_url to the signed URL of the first
// sheet_ref's rendered page asset. Reviewers get a thumbnail preview and a
// one-click jump to the source page. We don't bbox-crop yet — the full
// sheet image is infinitely better than no image, and adding image
// processing to the edge worker is a larger lift.
async function attachEvidenceCrops(
  admin: ReturnType<typeof createClient>,
  planReviewId: string,
): Promise<{ attached: number; skipped: number; unresolved_sheets: number }> {
  // Pull current findings (re-attach is idempotent because we only refresh
  // when the existing meta lacks page_index or the URL has expired).
  const { data: rows, error } = await admin
    .from("deficiencies_v2")
    .select("id, sheet_refs, evidence_crop_url, evidence_crop_meta")
    .eq("plan_review_id", planReviewId)
    .neq("status", "resolved")
    .neq("status", "waived");
  if (error) {
    console.error("[evidence_crops] read failed", error);
    return { attached: 0, skipped: 0, unresolved_sheets: 0 };
  }
  const findings = (rows ?? []) as Array<{
    id: string;
    sheet_refs: string[] | null;
    evidence_crop_url: string | null;
    evidence_crop_meta: Record<string, unknown> | null;
  }>;
  if (findings.length === 0) return { attached: 0, skipped: 0, unresolved_sheets: 0 };

  // Read the persisted sheet map so we know which page_index each sheet_ref
  // lives on. This was snapshotted by stageSheetMap.
  const { data: prRow, error: prErr } = await admin
    .from("plan_reviews")
    .select("checklist_state")
    .eq("id", planReviewId)
    .maybeSingle();
  if (prErr || !prRow) {
    console.error("[evidence_crops] plan_review read failed", prErr);
    return { attached: 0, skipped: findings.length, unresolved_sheets: 0 };
  }
  const checklist = (prRow.checklist_state ?? {}) as Record<string, unknown>;
  const rawMap = Array.isArray(checklist.last_sheet_map)
    ? (checklist.last_sheet_map as Array<{ sheet_ref?: string; page_index?: number }>)
    : [];

  // Build BOTH a strict and a fuzzy lookup so "A101", "A-101", "A-0101", and
  // "A.101" all resolve to the same page. This is the single biggest cause
  // of "no evidence" — AI emits "A101", title block says "A-101".
  const sheetToPage = new Map<string, number>();
  const fuzzyToPage = new Map<string, number>();
  const fuzzy = (s: string) =>
    s.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^([A-Z]+)0+(\d)/, "$1$2");
  for (const m of rawMap) {
    if (typeof m.sheet_ref === "string" && typeof m.page_index === "number") {
      sheetToPage.set(m.sheet_ref.toUpperCase().trim(), m.page_index);
      fuzzyToPage.set(fuzzy(m.sheet_ref), m.page_index);
    }
  }
  if (sheetToPage.size === 0) {
    return { attached: 0, skipped: findings.length, unresolved_sheets: findings.length };
  }

  const resolveSheet = (raw: string | null | undefined): { sheet: string; page: number } | null => {
    if (!raw) return null;
    const upper = raw.toUpperCase().trim();
    const exact = sheetToPage.get(upper);
    if (exact != null) return { sheet: upper, page: exact };
    const fuzzed = fuzzyToPage.get(fuzzy(upper));
    if (fuzzed != null) return { sheet: upper, page: fuzzed };
    return null;
  };

  // Sign every page once (signedSheetUrls caches), then index by page_index.
  const signed = await signedSheetUrls(admin, planReviewId);
  const pageUrlByIndex = new Map<number, string>();
  signed.forEach((s, i) => pageUrlByIndex.set(i, s.signed_url));

  // Also pull cached_until per page so we can stamp expiry into the meta and
  // let the client know when to call resign-page-asset.
  const { data: assetRows } = await admin
    .from("plan_review_page_assets")
    .select("page_index, cached_until")
    .eq("plan_review_id", planReviewId)
    .eq("status", "ready");
  const expiryByIndex = new Map<number, string>();
  for (const a of (assetRows ?? []) as Array<{ page_index: number; cached_until: string | null }>) {
    if (a.cached_until) expiryByIndex.set(a.page_index, a.cached_until);
  }

  let attached = 0;
  let skipped = 0;
  let unresolved = 0;
  for (const f of findings) {
    const meta = (f.evidence_crop_meta ?? {}) as Record<string, unknown>;
    const hasPageIndex = typeof meta.page_index === "number";
    const isPinned = meta.pinned === true;

    // Don't overwrite human-pinned crops — those are the reviewer's verified
    // selection. Only auto-fill when nothing exists OR when the auto crop is
    // missing the page_index resolver hint.
    if (isPinned) {
      skipped++;
      continue;
    }
    if (f.evidence_crop_url && hasPageIndex) {
      skipped++;
      continue;
    }

    const refs = f.sheet_refs ?? [];
    let resolved: { sheet: string; page: number } | null = null;
    for (const r of refs) {
      resolved = resolveSheet(r);
      if (resolved) break;
    }
    if (!resolved) {
      unresolved++;
      // Stamp meta so the client can render an honest "Sheet not located"
      // chip instead of pretending we have evidence.
      const { error: updErr } = await admin
        .from("deficiencies_v2")
        .update({
          evidence_crop_meta: {
            ...meta,
            unresolved_sheet: true,
            attempted_refs: refs,
            attempted_at: new Date().toISOString(),
          },
        })
        .eq("id", f.id);
      if (updErr) console.error("[evidence_crops] unresolved meta update", f.id, updErr);
      continue;
    }
    const url = pageUrlByIndex.get(resolved.page);
    if (!url) {
      skipped++;
      continue;
    }
    const { error: updErr } = await admin
      .from("deficiencies_v2")
      .update({
        evidence_crop_url: url,
        evidence_crop_meta: {
          ...meta,
          sheet_ref: resolved.sheet,
          page_index: resolved.page,
          signed_until: expiryByIndex.get(resolved.page) ?? null,
          source: "auto",
          unresolved_sheet: false,
          attached_at: new Date().toISOString(),
        },
      })
      .eq("id", f.id);
    if (updErr) {
      console.error("[evidence_crops] update failed", f.id, updErr);
      skipped++;
    } else {
      attached++;
    }
  }
  return { attached, skipped, unresolved_sheets: unresolved };
}

// ---------- main handler ----------

/**
 * Fire-and-forget self-invocation. Posts back to this same edge function with
 * a single `stage` to run, so each stage gets a fresh worker (= fresh memory
 * budget). MuPDF WASM, page buffers, and AI response state from the previous
 * stage never co-exist in one worker.
 */
function scheduleNextStage(
  planReviewId: string,
  nextStage: Stage,
  extra?: { mode?: PipelineMode },
) {
  const url = `${SUPABASE_URL}/functions/v1/run-review-pipeline`;
  // Don't await — return immediately and let waitUntil keep this socket alive
  // long enough for the request to flush.
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "x-internal-self-invoke": "1",
    },
    body: JSON.stringify({
      plan_review_id: planReviewId,
      stage: nextStage,
      mode: extra?.mode ?? "core",
      _internal: true,
    }),
  })
    .then((r) => {
      if (!r.ok) console.error(`[schedule] ${nextStage} → HTTP ${r.status}`);
    })
    .catch((e) => console.error(`[schedule] ${nextStage} fetch failed:`, e));
}

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
    const activeChain = stagesForMode(mode);
    // target_source dropped from the contract — the verify-only prepare_pages
    // never forks per-PDF workers. Body field is ignored if a legacy caller
    // still sends it.
    void body?.target_source;
    const isInternalSelfInvoke =
      body?._internal === true || req.headers.get("x-internal-self-invoke") === "1";

    if (!plan_review_id || typeof plan_review_id !== "string") {
      return new Response(JSON.stringify({ error: "plan_review_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authenticate the caller. Internal self-invokes use the service role key
    // as a bearer token, which getClaims() will reject — accept that case based
    // on the marker header + matching service role secret.
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
      // Verify the self-invoke really came from us.
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
      .select("id, firm_id")
      .eq("id", plan_review_id)
      .maybeSingle();
    if (prErr || !pr) {
      return new Response(JSON.stringify({ error: "plan_review not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const firmId = (pr as { firm_id: string | null }).firm_id;

    // Seed cost-telemetry context for this request. Individual stages can
    // refine via withCostCtx() to add discipline / chunk attribution.
    setCostCtx({
      admin,
      planReviewId: plan_review_id,
      firmId,
      stage: requestedStage ?? null,
      discipline: null,
      chunk: null,
    });


    // Resolve which single stage this invocation runs.
    // - First call (no `stage`, no `start_from`): seed pending rows for the
    //   active mode's chain and run its first stage.
    // - First call with `start_from`: seed only the trailing stages of the
    //   FULL chain (legacy partial reruns).
    // - Self-invoke (`stage` set): run exactly that stage. The mode comes
    //   along on the body so advancement stays within the same chain.
    let stageToRun: Stage;
    if (requestedStage) {
      stageToRun = requestedStage;
      // Make sure the requested stage at least has a pending row so the
      // dashboard can render it even if this is the first time we touch it.
      await setStage(admin, plan_review_id, firmId, stageToRun, { status: "pending" });
    } else if (startFrom) {
      stageToRun = startFrom;
      const idx = STAGES.indexOf(startFrom);
      const tail = idx >= 0 ? STAGES.slice(idx) : STAGES;
      for (const s of tail) {
        await setStage(admin, plan_review_id, firmId, s, { status: "pending" });
      }
    } else {
      stageToRun = activeChain[0];
      for (const s of activeChain) {
        await setStage(admin, plan_review_id, firmId, s, { status: "pending" });
      }
    }

    // prepare_pages watchdog removed: the stage is now O(1) (verify the
    // manifest, sign one URL) so it cannot get "stuck running". If the row
    // is in `running` state, the worker is genuinely doing the verify call.

    const stageImpls: Record<Stage, () => Promise<Record<string, unknown>>> = {
      upload: () => stageUpload(admin, plan_review_id),
      prepare_pages: () => stagePreparePages(admin, plan_review_id, firmId),
      sheet_map: () => stageSheetMap(admin, plan_review_id, firmId),
      submittal_check: () => stageSubmittalCheck(admin, plan_review_id, firmId),
      dna_extract: () =>
        startFrom && STAGES.indexOf(startFrom) > 0 && stageToRun === "dna_extract"
          ? stageDnaReevaluate(admin, plan_review_id)
          : stageDnaExtract(admin, plan_review_id, firmId),
      discipline_review: () => stageDisciplineReview(admin, plan_review_id, firmId),
      verify: () => stageVerify(admin, plan_review_id),
      dedupe: () => stageDedupe(admin, plan_review_id),
      ground_citations: () => stageGroundCitations(admin, plan_review_id),
      cross_check: () => stageCrossCheck(admin, plan_review_id, firmId),
      deferred_scope: () => stageDeferredScope(admin, plan_review_id, firmId),
      prioritize: () => stagePrioritize(admin, plan_review_id),
      complete: () => stageComplete(admin, plan_review_id),
    };

    // Cancellation check helper. The dashboard writes
    // `plan_reviews.ai_run_progress.cancelled_at` (ISO timestamp) when the
    // user clicks Cancel. Any worker that wakes up after that timestamp
    // halts immediately and does not schedule the next stage.
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
        await setStage(admin, plan_review_id, firmId, stageToRun, {
          status: "error",
          error_message: "Cancelled by user",
        });
        return;
      }

      // SEQUENTIAL PREPARE_PAGES: one worker per chunk, no racing. The
      // dispatcher's stale-row watchdog (above) is the safety net for when
      // a worker dies on a CPU limit before scheduling its successor.

      await setStage(admin, plan_review_id, firmId, stageToRun, { status: "running" });
      try {
        const meta = await withCostCtx({ stage: stageToRun }, () =>
          withRetry(() => stageImpls[stageToRun](), `stage:${stageToRun}`),
        );

        // prepare_pages is now a single O(1) verify call — no chunk loop, no
        // self-rescheduling. Falls straight through to the standard advance.

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

        // Advance within the active mode chain (Core or Deep). When a
        // self-invoke for a single stage finishes, we still advance using
        // the mode the caller passed — so re-running an arbitrary stage
        // never accidentally drags the user back into the old long pipeline.
        if (await isCancelled()) return;
        const idx = activeChain.indexOf(stageToRun);
        const next = idx >= 0 ? activeChain[idx + 1] : undefined;
        if (next) {
          // Don't double-schedule: if the watchdog or a recovery worker raced
          // us to advance the chain, the next stage may already be running.
          const { data: nextRow } = await admin
            .from("review_pipeline_status")
            .select("status")
            .eq("plan_review_id", plan_review_id)
            .eq("stage", next)
            .maybeSingle();
          const ns = (nextRow as { status?: string } | null)?.status;
          if (ns !== "running" && ns !== "complete") {
            scheduleNextStage(plan_review_id, next, { mode });
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        // LOW_YIELD_REVIEW: pipeline already wrote ai_check_status='needs_human_review'.
        // Just halt the chain — no retry, no advancement.
        if (message.includes("LOW_YIELD_REVIEW")) {
          await setStage(admin, plan_review_id, firmId, stageToRun, {
            status: "error",
            error_message: message,
            metadata: { error_class: "LOW_YIELD_REVIEW" },
          });
          return;
        }

        // prepare_pages is now verify-only. Any throw here means the manifest
        // is missing/corrupt — only the BROWSER can rasterize the source PDFs
        // (Supabase Edge can't reliably finish even one page in its CPU
        // budget). Surface a clear error class + log row so the dashboard can
        // show a one-click "Re-prepare in browser" CTA.
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
          return;
        }

        // Non-fatal stages get bounded retry too — a single transient AI
        // gateway hiccup at sheet_map or dedupe used to strand the chain.
        // Cap at 3 attempts then fall through to the existing error path.
        const NON_FATAL_RETRY_STAGES = new Set<Stage>([
          "sheet_map",
          "discipline_review",
          "verify",
          "dedupe",
          "ground_citations",
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
              scheduleNextStage(plan_review_id, stageToRun, { mode });
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
          const idx = activeChain.indexOf(stageToRun);
          const next = idx >= 0 ? activeChain[idx + 1] : undefined;
          if (next) scheduleNextStage(plan_review_id, next, { mode });
        }
      }
    };

    // Run this single stage as a background task and return 202 immediately.
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
      JSON.stringify({ ok: true, accepted: true, plan_review_id, stage: stageToRun, mode }),
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
