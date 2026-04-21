// Edge function: orchestrates the 8-stage plan review pipeline.
// Writes per-stage status to public.review_pipeline_status so the dashboard
// stepper updates in realtime. Each stage is isolated: a failure marks that
// stage 'error' and (where it makes sense) flags the discipline as
// requires_human_review on downstream deficiencies, but the overall pipeline
// continues to the next stage where possible.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type Stage =
  | "upload"
  | "sheet_map"
  | "dna_extract"
  | "discipline_review"
  | "cross_check"
  | "deferred_scope"
  | "prioritize"
  | "complete";

const STAGES: Stage[] = [
  "upload",
  "sheet_map",
  "dna_extract",
  "discipline_review",
  "cross_check",
  "deferred_scope",
  "prioritize",
  "complete",
];

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const DISCIPLINES = [
  "Architectural",
  "Structural",
  "Energy",
  "Accessibility",
  "Product Approvals",
  "MEP",
];

// ---------- helpers ----------

async function setStage(
  admin: ReturnType<typeof createClient>,
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
  if (patch.status === "running") payload.started_at = now;
  if (patch.status === "complete" || patch.status === "error") {
    payload.completed_at = now;
  }

  // upsert by (plan_review_id, stage)
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

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts = 3,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      console.error(`[${label}] attempt ${attempt} failed:`, err);
      if (attempt === maxAttempts) break;
      const backoff = Math.min(8000, 500 * Math.pow(2, attempt - 1));
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

async function callAI(
  systemPrompt: string,
  userPrompt: string,
  toolSchema?: Record<string, unknown>,
) {
  const body: Record<string, unknown> = {
    model: "google/gemini-3-flash-preview",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  };
  if (toolSchema) {
    body.tools = [{ type: "function", function: toolSchema }];
    body.tool_choice = {
      type: "function",
      function: { name: (toolSchema as { name: string }).name },
    };
  }

  const resp = await fetch(
    "https://ai.gateway.lovable.dev/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (resp.status === 429) throw new Error("rate_limited");
  if (resp.status === 402) throw new Error("payment_required");
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`ai gateway ${resp.status}: ${t.slice(0, 200)}`);
  }

  const data = await resp.json();
  if (toolSchema) {
    const args =
      data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) throw new Error("no tool args returned");
    return JSON.parse(args);
  }
  return data.choices?.[0]?.message?.content ?? "";
}

// ---------- stage implementations ----------
// Note: these are intentionally lightweight scaffolds. They populate the new
// tables with sensible records so the dashboard renders, and provide the
// integration points for the deeper Gemini extraction work in the next PR.

async function stageUpload(
  admin: ReturnType<typeof createClient>,
  planReviewId: string,
) {
  const { data, error } = await admin
    .from("plan_review_files")
    .select("id, file_path")
    .eq("plan_review_id", planReviewId);
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("No files uploaded for this plan review");
  }
  return { file_count: data.length };
}

async function stageSheetMap(
  admin: ReturnType<typeof createClient>,
  planReviewId: string,
  firmId: string | null,
) {
  // If sheet_coverage already exists for this review, no-op.
  const { count } = await admin
    .from("sheet_coverage")
    .select("id", { count: "exact", head: true })
    .eq("plan_review_id", planReviewId);
  if ((count ?? 0) > 0) return { sheets: count };

  // Seed an expected-sheet baseline so the SheetCoverageMap shows something
  // useful even before vision extraction runs. The discipline_review stage
  // (next PR) will mark these present/missing based on actual extraction.
  const baseline = [
    { sheet_ref: "G-001", sheet_title: "Cover / Code Summary", discipline: "General" },
    { sheet_ref: "A-001", sheet_title: "Site Plan", discipline: "Architectural" },
    { sheet_ref: "A-101", sheet_title: "Floor Plan", discipline: "Architectural" },
    { sheet_ref: "A-201", sheet_title: "Elevations", discipline: "Architectural" },
    { sheet_ref: "S-001", sheet_title: "Structural Notes", discipline: "Structural" },
    { sheet_ref: "S-101", sheet_title: "Foundation Plan", discipline: "Structural" },
    { sheet_ref: "M-101", sheet_title: "Mechanical Plan", discipline: "MEP" },
    { sheet_ref: "E-101", sheet_title: "Electrical Plan", discipline: "MEP" },
    { sheet_ref: "P-101", sheet_title: "Plumbing Plan", discipline: "MEP" },
  ];

  const rows = baseline.map((b, i) => ({
    plan_review_id: planReviewId,
    firm_id: firmId,
    sheet_ref: b.sheet_ref,
    sheet_title: b.sheet_title,
    discipline: b.discipline,
    expected: true,
    status: "missing_minor", // until extraction confirms presence
    page_index: i,
  }));
  const { error } = await admin.from("sheet_coverage").insert(rows);
  if (error) throw error;
  return { sheets: rows.length };
}

async function stageDnaExtract(
  admin: ReturnType<typeof createClient>,
  planReviewId: string,
  firmId: string | null,
) {
  const { data: existing } = await admin
    .from("project_dna")
    .select("id")
    .eq("plan_review_id", planReviewId)
    .maybeSingle();
  if (existing?.id) return { reused: true };

  // Pull project address/county to seed the DNA row. Vision extraction in the
  // next PR will overwrite the speculative fields.
  const { data: pr } = await admin
    .from("plan_reviews")
    .select("project_id, fbc_edition, projects(address, jurisdiction, county)")
    .eq("id", planReviewId)
    .maybeSingle();

  const project = (pr as unknown as {
    project_id: string;
    fbc_edition: string | null;
    projects: { address: string; jurisdiction: string; county: string } | null;
  } | null);

  const seed = {
    plan_review_id: planReviewId,
    firm_id: firmId,
    fbc_edition: project?.fbc_edition ?? "8th",
    jurisdiction: project?.projects?.jurisdiction ?? null,
    county: project?.projects?.county ?? null,
    missing_fields: [
      "occupancy_classification",
      "construction_type",
      "total_sq_ft",
      "stories",
      "wind_speed_vult",
      "exposure_category",
      "risk_category",
    ],
    ambiguous_fields: [],
    raw_extraction: {},
  };
  const { error } = await admin.from("project_dna").insert(seed);
  if (error) throw error;
  return { seeded: true };
}

async function stageDisciplineReview(
  admin: ReturnType<typeof createClient>,
  planReviewId: string,
  firmId: string | null,
) {
  // Per-discipline failure isolation: a failed discipline marks its
  // generated deficiencies as requires_human_review and we continue.
  const failed: string[] = [];
  for (const discipline of DISCIPLINES) {
    try {
      await runDisciplineChecks(admin, planReviewId, firmId, discipline);
    } catch (err) {
      console.error(`[discipline_review:${discipline}] failed:`, err);
      failed.push(discipline);
      // Insert a single human-review placeholder so the dashboard surfaces it
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
  return { failed_disciplines: failed };
}

async function runDisciplineChecks(
  admin: ReturnType<typeof createClient>,
  planReviewId: string,
  firmId: string | null,
  discipline: string,
) {
  // Pull this discipline's negative-space checklist (deterministic items).
  const { data: items } = await admin
    .from("discipline_negative_space")
    .select("item_key, description, fbc_section")
    .eq("discipline", discipline)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (!items || items.length === 0) return;

  // For now, scaffold one DEF per checklist item flagged as "needs verification"
  // — this seeds the dashboard. Vision extraction (next PR) will replace these
  // with actual evidence-based findings.
  const rows = items.slice(0, 5).map((it, idx) => ({
    plan_review_id: planReviewId,
    firm_id: firmId,
    def_number: `DEF-${discipline.slice(0, 1).toUpperCase()}${String(idx + 1).padStart(3, "0")}`,
    discipline,
    sheet_refs: [],
    code_reference: it.fbc_section
      ? { code: "FBC", section: it.fbc_section, edition: "8th" }
      : {},
    finding: `Verify: ${it.description}`,
    required_action: `Confirm presence and adequacy of: ${it.description}`,
    evidence: [],
    priority: "medium",
    requires_human_review: true,
    human_review_reason: "Awaiting vision-based verification",
    human_review_verify: it.description,
    confidence_score: 0.4,
    confidence_basis: "Checklist seed — no vision evidence yet",
    status: "open",
  }));
  if (rows.length === 0) return;
  const { error } = await admin.from("deficiencies_v2").insert(rows);
  if (error) throw error;
}

async function stageCrossCheck(
  _admin: ReturnType<typeof createClient>,
  _planReviewId: string,
) {
  // Placeholder: future logic will scan deficiencies_v2 for duplicate
  // (FBC section + sheet) and contradiction (resolved-in-prior-round) flags.
  return { duplicates_found: 0 };
}

async function stageDeferredScope(
  _admin: ReturnType<typeof createClient>,
  _planReviewId: string,
) {
  // Placeholder for deferred-submittal detection.
  return { deferred_items: 0 };
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
  await admin
    .from("plan_reviews")
    .update({ ai_check_status: "complete", updated_at: new Date().toISOString() })
    .eq("id", planReviewId);
  return { ok: true };
}

// ---------- main handler ----------

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

    // Validate caller
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

    const { plan_review_id } = await req.json().catch(() => ({}));
    if (!plan_review_id || typeof plan_review_id !== "string") {
      return new Response(JSON.stringify({ error: "plan_review_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service role for the orchestration so we can bypass RLS where needed
    // (e.g. inserting pipeline_status for any firm member starting the run).
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

    // Mark all stages pending up-front so the stepper renders immediately.
    for (const s of STAGES) {
      await setStage(admin, plan_review_id, firmId, s, { status: "pending" });
    }

    const stageImpls: Record<Stage, () => Promise<Record<string, unknown>>> = {
      upload: () => stageUpload(admin, plan_review_id),
      sheet_map: () => stageSheetMap(admin, plan_review_id, firmId),
      dna_extract: () => stageDnaExtract(admin, plan_review_id, firmId),
      discipline_review: () => stageDisciplineReview(admin, plan_review_id, firmId),
      cross_check: () => stageCrossCheck(admin, plan_review_id),
      deferred_scope: () => stageDeferredScope(admin, plan_review_id),
      prioritize: () => stagePrioritize(admin, plan_review_id),
      complete: () => stageComplete(admin, plan_review_id),
    };

    const results: Record<string, unknown> = {};
    let halted = false;

    for (const stage of STAGES) {
      if (halted) {
        await setStage(admin, plan_review_id, firmId, stage, {
          status: "error",
          error_message: "Skipped — earlier stage failed",
        });
        continue;
      }
      await setStage(admin, plan_review_id, firmId, stage, { status: "running" });
      try {
        const meta = await withRetry(() => stageImpls[stage](), `stage:${stage}`);
        results[stage] = meta;
        await setStage(admin, plan_review_id, firmId, stage, {
          status: "complete",
          metadata: meta,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results[stage] = { error: message };
        await setStage(admin, plan_review_id, firmId, stage, {
          status: "error",
          error_message: message,
        });
        // 'upload' and 'dna_extract' are hard prerequisites — halt if they fail.
        if (stage === "upload" || stage === "dna_extract") halted = true;
      }
    }

    return new Response(JSON.stringify({ ok: !halted, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (e) {
    console.error("run-review-pipeline fatal:", e);
    const message = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
