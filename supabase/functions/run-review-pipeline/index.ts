// Edge function: orchestrates the 8-stage plan review pipeline.
// Writes per-stage status to public.review_pipeline_status so the dashboard
// stepper updates in realtime. Each stage is isolated: a failure marks that
// stage 'error' and (where it makes sense) flags the discipline as
// requires_human_review on downstream deficiencies, but the overall pipeline
// continues to the next stage where possible.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { composeDisciplineSystemPrompt } from "./discipline-experts.ts";

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
  | "verify"
  | "dedupe"
  | "ground_citations"
  | "cross_check"
  | "deferred_scope"
  | "prioritize"
  | "complete";

const STAGES: Stage[] = [
  "upload",
  "sheet_map",
  "dna_extract",
  "discipline_review",
  "verify",
  "dedupe",
  "ground_citations",
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
  "Life Safety",
  "Civil",
  "Landscape",
];

/**
 * Map AI-extracted sheet_coverage.discipline → our internal DISCIPLINES list.
 * The sheet_map stage uses an enum {General, Architectural, Structural, MEP,
 * Energy, Accessibility, Civil, Landscape, Other}. We don't have a 1:1 for
 * "Product Approvals" (that's a doc category, not a sheet) and "Life Safety"
 * is sometimes labeled Architectural. This normalizer keeps routing honest.
 */
function normalizeAIDiscipline(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const k = raw.trim().toLowerCase();
  if (k === "general" || k === "other") return null;
  if (k === "architectural" || k === "arch") return "Architectural";
  if (k === "structural" || k === "struct") return "Structural";
  if (k === "mep" || k === "mechanical" || k === "electrical" || k === "plumbing" || k === "fire protection" || k === "fp") return "MEP";
  if (k === "energy") return "Energy";
  if (k === "accessibility" || k === "ada") return "Accessibility";
  if (k === "civil" || k === "site") return "Civil";
  if (k === "landscape" || k === "irrigation") return "Landscape";
  if (k === "life safety" || k === "ls") return "Life Safety";
  return null;
}

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

type ChatMessage = {
  role: "system" | "user";
  content: string | Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  >;
};

async function callAI(
  messages: ChatMessage[],
  toolSchema?: Record<string, unknown>,
  model = "google/gemini-2.5-pro",
) {
  const body: Record<string, unknown> = { model, messages };
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

// ---------- discipline routing ----------

/** Map a sheet_ref prefix to the discipline that should review it. */
function disciplineForSheet(sheetRef: string): string | null {
  const p = sheetRef.trim().toUpperCase()[0];
  switch (p) {
    case "A":
      return "Architectural";
    case "S":
      return "Structural";
    case "M":
    case "P":
    case "E":
    case "F":
      return "MEP";
    case "L":
      return "Accessibility"; // life-safety / landscape sometimes
    default:
      return null; // G-, T-, cover sheets → general notes, sent to every call
  }
}

/**
 * @deprecated Prefer `sheet_coverage.discipline` (AI-extracted from the title block).
 * This prefix heuristic is kept ONLY as a last-resort fallback when sheet_map
 * fails or returns "General"/"Other" for a sheet that clearly belongs elsewhere.
 *
 * Why deprecated: prefix routing miscategorizes Life Safety (LS), Fire Protection
 * (FP), Civil (C), Landscape (L), and detail sheets like AS-101 (assigned to the
 * wrong discipline). The AI can read the title block and gets these right.
 */
function disciplineForSheetFallback(sheetRef: string): string | null {
  const p = sheetRef.trim().toUpperCase()[0];
  switch (p) {
    case "A":
      return "Architectural";
    case "S":
      return "Structural";
    case "M":
    case "P":
    case "E":
    case "F":
      return "MEP";
    case "C":
      return "Civil";
    case "L":
      return "Landscape";
    default:
      return null; // G-, T-, cover sheets → general notes, sent to every call
  }
}

/** Sign each plan file (PDFs/images in `documents` bucket) for vision input. */
async function signedSheetUrls(
  admin: ReturnType<typeof createClient>,
  planReviewId: string,
): Promise<Array<{ file_path: string; signed_url: string }>> {
  const { data: files, error } = await admin
    .from("plan_review_files")
    .select("file_path")
    .eq("plan_review_id", planReviewId)
    .order("uploaded_at", { ascending: true });
  if (error) throw error;
  const out: Array<{ file_path: string; signed_url: string }> = [];
  for (const f of (files ?? []) as Array<{ file_path: string }>) {
    const { data: signed, error: sErr } = await admin.storage
      .from("documents")
      .createSignedUrl(f.file_path, 60 * 60); // 60min — long enough for slowest discipline run
    if (sErr || !signed) continue;
    out.push({ file_path: f.file_path, signed_url: signed.signedUrl });
  }
  return out;
}

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

const SHEET_MAP_SCHEMA = {
  name: "submit_sheet_map",
  description:
    "Return one entry per supplied page. Read the actual title block. If a page has no recognizable sheet number (e.g. response letter, calc cover), set sheet_ref to 'X-NA' and discipline to 'General'.",
  parameters: {
    type: "object",
    properties: {
      sheets: {
        type: "array",
        items: {
          type: "object",
          properties: {
            page_index: { type: "integer", minimum: 0 },
            sheet_ref: {
              type: "string",
              description:
                "Sheet identifier exactly as printed in the title block (e.g. A-101, S2.01, M-001).",
            },
            sheet_title: { type: "string" },
            discipline: {
              type: "string",
              enum: [
                "General",
                "Architectural",
                "Structural",
                "MEP",
                "Energy",
                "Accessibility",
                "Civil",
                "Landscape",
                "Life Safety",
                "Fire Protection",
                "Other",
              ],
            },
          },
          required: ["page_index", "sheet_ref", "discipline"],
          additionalProperties: false,
        },
      },
    },
    required: ["sheets"],
    additionalProperties: false,
  },
} as const;

const EXPECTED_SHEETS_BY_DISCIPLINE: Record<string, string[]> = {
  Architectural: ["A-001", "A-101", "A-201"],
  Structural: ["S-001", "S-101"],
  MEP: ["M-101", "E-101", "P-101"],
};

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

  const signed = await signedSheetUrls(admin, planReviewId);
  if (signed.length === 0) throw new Error("No signed file URLs available");

  // Vision-extract the actual title block from each page in batches of 8.
  const present: Array<{
    page_index: number;
    sheet_ref: string;
    sheet_title: string | null;
    discipline: string;
  }> = [];

  const BATCH = 8;
  for (let start = 0; start < signed.length; start += BATCH) {
    const slice = signed.slice(start, start + BATCH);
    const userText =
      `Identify each page's title block. The pages are supplied in order. ` +
      `page_index values for this batch must be ${start}..${start + slice.length - 1}. ` +
      `Return one entry per page via submit_sheet_map.`;
    const content: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    > = [
      { type: "text", text: userText },
      ...slice.map((s) => ({
        type: "image_url" as const,
        image_url: { url: s.signed_url },
      })),
    ];

    try {
      const result = (await callAI(
        [
          {
            role: "system",
            content:
              "You are a Florida plan reviewer indexing a construction document set. Read each page's title block exactly. Never invent sheet numbers.",
          },
          { role: "user", content },
        ],
        SHEET_MAP_SCHEMA as unknown as Record<string, unknown>,
        "google/gemini-2.5-flash",
      )) as {
        sheets: Array<{
          page_index: number;
          sheet_ref: string;
          sheet_title?: string;
          discipline: string;
        }>;
      };
      for (const s of result?.sheets ?? []) {
        present.push({
          page_index: s.page_index,
          sheet_ref: (s.sheet_ref || `X-${s.page_index}`).toUpperCase().slice(0, 32),
          sheet_title: s.sheet_title?.slice(0, 200) ?? null,
          discipline: s.discipline ?? "General",
        });
      }
    } catch (err) {
      console.error(`[sheet_map] batch ${start} failed:`, err);
      // Fall back to a placeholder entry for each page in this batch
      for (let i = 0; i < slice.length; i++) {
        present.push({
          page_index: start + i,
          sheet_ref: `X-${start + i}`,
          sheet_title: null,
          discipline: "General",
        });
      }
    }
  }

  const presentRows = present.map((p) => ({
    plan_review_id: planReviewId,
    firm_id: firmId,
    sheet_ref: p.sheet_ref,
    sheet_title: p.sheet_title,
    discipline: p.discipline,
    expected: true,
    status: "present",
    page_index: p.page_index,
  }));

  // Compute missing-critical sheets per discipline (heuristic baseline).
  const presentRefs = new Set(present.map((p) => p.sheet_ref));
  const missingRows: typeof presentRows = [];
  for (const [discipline, expected] of Object.entries(EXPECTED_SHEETS_BY_DISCIPLINE)) {
    for (const ref of expected) {
      if (!presentRefs.has(ref)) {
        missingRows.push({
          plan_review_id: planReviewId,
          firm_id: firmId,
          sheet_ref: ref,
          sheet_title: null,
          discipline,
          expected: true,
          status: "missing_critical",
          page_index: null,
        });
      }
    }
  }

  const allRows = [...presentRows, ...missingRows];
  if (allRows.length === 0) return { sheets: 0 };
  const { error } = await admin.from("sheet_coverage").insert(allRows);
  if (error) throw error;
  return {
    sheets: allRows.length,
    present: presentRows.length,
    missing_critical: missingRows.length,
  };
}

const DNA_SCHEMA = {
  name: "submit_project_dna",
  description:
    "Extract Florida Building Code project DNA from cover/code-summary sheets. Read values verbatim. Use null when not directly readable; list those keys in missing_fields. List keys with conflicting values across sheets in ambiguous_fields.",
  parameters: {
    type: "object",
    properties: {
      occupancy_classification: { type: ["string", "null"] },
      construction_type: { type: ["string", "null"] },
      total_sq_ft: { type: ["number", "null"] },
      stories: { type: ["integer", "null"] },
      fbc_edition: { type: ["string", "null"] },
      wind_speed_vult: { type: ["integer", "null"] },
      exposure_category: { type: ["string", "null"] },
      risk_category: { type: ["string", "null"] },
      flood_zone: { type: ["string", "null"] },
      hvhz: { type: ["boolean", "null"] },
      mixed_occupancy: { type: ["boolean", "null"] },
      is_high_rise: { type: ["boolean", "null"] },
      has_mezzanine: { type: ["boolean", "null"] },
      seismic_design_category: { type: ["string", "null"] },
      missing_fields: { type: "array", items: { type: "string" } },
      ambiguous_fields: { type: "array", items: { type: "string" } },
      evidence_notes: {
        type: "string",
        description: "Brief notes on which sheet supplied which value.",
      },
    },
    required: ["missing_fields", "ambiguous_fields"],
    additionalProperties: false,
  },
} as const;

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

  const { data: pr } = await admin
    .from("plan_reviews")
    .select("project_id, fbc_edition, projects(address, jurisdiction, county)")
    .eq("id", planReviewId)
    .maybeSingle();

  const project = pr as unknown as {
    project_id: string;
    fbc_edition: string | null;
    projects: { address: string; jurisdiction: string; county: string } | null;
  } | null;

  // Pick cover/code-summary pages from sheet_coverage; fall back to first 3 pages.
  const [{ data: coverSheets }, signed] = await Promise.all([
    admin
      .from("sheet_coverage")
      .select("page_index, sheet_ref, sheet_title")
      .eq("plan_review_id", planReviewId)
      .eq("status", "present")
      .in("discipline", ["General"])
      .order("page_index", { ascending: true })
      .limit(4),
    signedSheetUrls(admin, planReviewId),
  ]);

  let imageUrls: string[] = [];
  if (coverSheets && coverSheets.length > 0) {
    imageUrls = (coverSheets as Array<{ page_index: number | null }>)
      .map((s) => signed[s.page_index ?? -1]?.signed_url)
      .filter(Boolean) as string[];
  }
  if (imageUrls.length === 0) {
    imageUrls = signed.slice(0, 3).map((s) => s.signed_url);
  }

  const baseDefaults = {
    plan_review_id: planReviewId,
    firm_id: firmId,
    fbc_edition: project?.fbc_edition ?? "8th",
    jurisdiction: project?.projects?.jurisdiction ?? null,
    county: project?.projects?.county ?? null,
  };

  if (imageUrls.length === 0) {
    const seed = {
      ...baseDefaults,
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
      raw_extraction: { reason: "no_images_available" },
    };
    const { error } = await admin.from("project_dna").insert(seed);
    if (error) throw error;
    return { seeded: true, source: "no_images" };
  }

  const userText =
    `Read the project DNA from the supplied cover / code-summary pages. ` +
    `Florida project. Address: ${project?.projects?.address ?? "(unknown)"}, ` +
    `County: ${project?.projects?.county ?? "(unknown)"}. ` +
    `Return values via submit_project_dna. ` +
    `If the county is Miami-Dade, Broward, or Monroe, hvhz must be true. ` +
    `If you cannot read a value, set it to null and add the key to missing_fields. ` +
    `If two sheets disagree, pick the most authoritative and add the key to ambiguous_fields.`;

  let extracted: Record<string, unknown> = {};
  try {
    extracted = (await callAI(
      [
        {
          role: "system",
          content:
            "You are a Florida private-provider plan reviewer extracting project DNA. Read code summaries verbatim. Never invent values.",
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
      DNA_SCHEMA as unknown as Record<string, unknown>,
    )) as Record<string, unknown>;
  } catch (err) {
    console.error("[dna_extract] vision call failed:", err);
    extracted = {
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
    };
  }

  const row = {
    ...baseDefaults,
    occupancy_classification:
      (extracted.occupancy_classification as string | null) ?? null,
    construction_type: (extracted.construction_type as string | null) ?? null,
    total_sq_ft: (extracted.total_sq_ft as number | null) ?? null,
    stories: (extracted.stories as number | null) ?? null,
    fbc_edition:
      (extracted.fbc_edition as string | null) ??
      project?.fbc_edition ??
      "8th",
    wind_speed_vult: (extracted.wind_speed_vult as number | null) ?? null,
    exposure_category: (extracted.exposure_category as string | null) ?? null,
    risk_category: (extracted.risk_category as string | null) ?? null,
    flood_zone: (extracted.flood_zone as string | null) ?? null,
    hvhz: (extracted.hvhz as boolean | null) ?? null,
    mixed_occupancy: (extracted.mixed_occupancy as boolean | null) ?? null,
    is_high_rise: (extracted.is_high_rise as boolean | null) ?? null,
    has_mezzanine: (extracted.has_mezzanine as boolean | null) ?? null,
    seismic_design_category:
      (extracted.seismic_design_category as string | null) ?? null,
    missing_fields:
      (extracted.missing_fields as string[] | undefined) ?? [],
    ambiguous_fields:
      (extracted.ambiguous_fields as string[] | undefined) ?? [],
    raw_extraction: extracted,
  };

  const { error } = await admin.from("project_dna").insert(row);
  if (error) throw error;

  const health = evaluateDnaHealth(row, project?.projects?.county ?? null);
  return {
    extracted: true,
    pages_read: imageUrls.length,
    missing: row.missing_fields.length,
    ...health,
  };
}

// Critical fields used to compute completeness. Wrong/missing here = wrong findings downstream.
const CRITICAL_DNA_FIELDS = [
  "occupancy_classification",
  "construction_type",
  "county",
  "stories",
  "total_sq_ft",
  "fbc_edition",
] as const;

interface DnaHealth {
  completeness: number;
  critical_missing: string[];
  jurisdiction_mismatch: boolean;
  blocking: boolean;
  block_reason: string | null;
}

function evaluateDnaHealth(
  dna: Record<string, unknown>,
  projectCounty: string | null,
): DnaHealth {
  const criticalMissing: string[] = [];
  for (const f of CRITICAL_DNA_FIELDS) {
    const v = dna[f];
    if (v === null || v === undefined || v === "") criticalMissing.push(f);
  }
  const completeness =
    (CRITICAL_DNA_FIELDS.length - criticalMissing.length) /
    CRITICAL_DNA_FIELDS.length;

  // Hard mismatch: extracted county doesn't match project county
  // (wrong county => wrong code edition + HVHZ rules => every finding suspect).
  const dnaCounty = (dna.county as string | null)?.toLowerCase().trim() || null;
  const projCounty = projectCounty?.toLowerCase().trim() || null;
  const jurisdictionMismatch =
    !!dnaCounty && !!projCounty && dnaCounty !== projCounty;

  let blocking = false;
  let block_reason: string | null = null;
  if (criticalMissing.includes("county")) {
    blocking = true;
    block_reason = "County missing from extracted DNA — cannot apply jurisdiction-specific code.";
  } else if (jurisdictionMismatch) {
    blocking = true;
    block_reason = `Extracted county (${dna.county}) does not match project county (${projectCounty}) — wrong code edition would be applied.`;
  } else if (completeness < 0.5) {
    blocking = true;
    block_reason = `Only ${Math.round(completeness * 100)}% of critical DNA fields populated — findings would be unreliable.`;
  }

  return {
    completeness,
    critical_missing: criticalMissing,
    jurisdiction_mismatch: jurisdictionMismatch,
    blocking,
    block_reason,
  };
}

/**
 * Re-evaluate DNA health from the current row in project_dna (used after a
 * reviewer manually patches missing fields and re-runs the pipeline from
 * `verify` onwards). No vision call — pure DB read + score.
 */
async function stageDnaReevaluate(
  admin: ReturnType<typeof createClient>,
  planReviewId: string,
) {
  const { data: dna, error } = await admin
    .from("project_dna")
    .select("*, plan_reviews!inner(projects(county))")
    .eq("plan_review_id", planReviewId)
    .maybeSingle();
  if (error) throw error;
  if (!dna) throw new Error("No project_dna row to re-evaluate");
  const projectCounty =
    ((dna as unknown as { plan_reviews?: { projects?: { county?: string } } })
      .plan_reviews?.projects?.county) ?? null;
  const health = evaluateDnaHealth(dna as Record<string, unknown>, projectCounty);
  return { reevaluated: true, ...health };
}

async function stageDisciplineReview(
  admin: ReturnType<typeof createClient>,
  planReviewId: string,
  firmId: string | null,
) {
  // Load context once and share across all discipline calls.
  const [sheets, signedUrls, dnaRow, jurisdictionRow] = await Promise.all([
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
      .select("projects(county)")
      .eq("id", planReviewId)
      .maybeSingle(),
  ]);

  const allSheets = (sheets.data ?? []) as Array<{
    sheet_ref: string;
    sheet_title: string | null;
    discipline: string | null;
    page_index: number | null;
  }>;
  const dna = (dnaRow.data ?? null) as Record<string, unknown> | null;
  const county = ((jurisdictionRow.data ?? null) as
    | { projects: { county: string } | null }
    | null)?.projects?.county ?? null;

  let jurisdiction: Record<string, unknown> | null = null;
  if (county) {
    const { data: jr } = await admin
      .from("jurisdictions_fl")
      .select("*")
      .eq("county", county)
      .maybeSingle();
    jurisdiction = (jr ?? null) as Record<string, unknown> | null;
  }

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

  for (const discipline of DISCIPLINES) {
    try {
      const disciplineSheets = routed.filter((s) => s.discipline === discipline);
      const disciplineImageUrls = disciplineSheets
        .map((s) => signedUrls[s.page_index ?? -1]?.signed_url)
        .filter(Boolean) as string[];

      // No sheets routed → log a single human-review item and continue.
      if (disciplineImageUrls.length === 0) {
        await admin.from("deficiencies_v2").insert({
          plan_review_id: planReviewId,
          firm_id: firmId,
          def_number: `DEF-${discipline.slice(0, 1).toUpperCase()}001`,
          discipline,
          finding: `No ${discipline} sheets identified in submittal.`,
          required_action: `Confirm whether ${discipline} scope applies; if so, request the missing sheets.`,
          priority: "medium",
          requires_human_review: true,
          human_review_reason: "No sheets routed to this discipline (AI title-block + prefix fallback both empty).",
          human_review_method: "Reviewer: confirm scope and request missing sheets if applicable.",
          confidence_score: 0.3,
          confidence_basis: "Sheet routing produced no inputs for this discipline.",
          status: "open",
        });
        continue;
      }

      const inserted = await runDisciplineChecks(admin, planReviewId, firmId, {
        discipline,
        disciplineSheets,
        disciplineImageUrls,
        generalImageUrls,
        dna,
        jurisdiction,
      });
      totalFindings += inserted;
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
  return { failed_disciplines: failed, total_findings: totalFindings };
}

interface DisciplineRunCtx {
  discipline: string;
  disciplineSheets: Array<{ sheet_ref: string; sheet_title: string | null }>;
  disciplineImageUrls: string[];
  generalImageUrls: string[];
  dna: Record<string, unknown> | null;
  jurisdiction: Record<string, unknown> | null;
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
  let patternQuery = admin
    .from("correction_patterns")
    .select("id, pattern_summary, original_finding, code_reference, reason_notes, rejection_count")
    .eq("discipline", ctx.discipline)
    .eq("is_active", true)
    .order("rejection_count", { ascending: false })
    .order("last_seen_at", { ascending: false })
    .limit(20);
  if (firmId) patternQuery = patternQuery.eq("firm_id", firmId);
  const { data: patternsData } = await patternQuery;
  const patterns = (patternsData ?? []) as Array<{
    id: string;
    pattern_summary: string;
    original_finding: string;
    code_reference: { section?: string } | null;
    reason_notes: string;
    rejection_count: number;
  }>;
  // Filter for project-DNA relevance when possible (best-effort).
  const relevantPatterns = patterns.slice(0, 12);

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

  const userText =
    `## Project DNA\n${dnaSummary}\n\n` +
    `## Jurisdiction\n${jurSummary}\n\n` +
    `## Sheets routed to ${ctx.discipline}\n${sheetIndex || "(none)"}\n\n` +
    `## Mandatory ${ctx.discipline} checklist\n${checklistText}` +
    memoryBlock +
    `\n\nAnalyze the attached pages (general-notes pages first, then ${ctx.discipline} sheets). ` +
    `Return findings via submit_discipline_findings.`;

  // Avoid unused-variable warnings on context vars used only for relevance heuristics.
  void occupancy;
  void constructionType;
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

  // Find next available DEF number for this discipline within the review.
  const { count: existingCount } = await admin
    .from("deficiencies_v2")
    .select("id", { count: "exact", head: true })
    .eq("plan_review_id", planReviewId)
    .eq("discipline", ctx.discipline);
  const baseIdx = (existingCount ?? 0) + 1;

  const rows = findings.map((f, i) => ({
    plan_review_id: planReviewId,
    firm_id: firmId,
    def_number: `DEF-${ctx.discipline.slice(0, 1).toUpperCase()}${String(
      baseIdx + i,
    ).padStart(3, "0")}`,
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
    model_version: "google/gemini-2.5-pro",
    status: "open",
  }));

  const { error } = await admin.from("deficiencies_v2").insert(rows);
  if (error) throw error;
  return rows.length;
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

  // Cap at 12 sheets to keep the call within model limits / cost. Prefer sheets
  // that are most likely to have cross-sheet relationships.
  const PRIORITY_PREFIXES = ["A", "S", "M", "P", "E", "F", "L", "G"];
  const ranked = [...allSheets].sort((a, b) => {
    const ai = PRIORITY_PREFIXES.indexOf(a.sheet_ref.trim().toUpperCase()[0] ?? "Z");
    const bi = PRIORITY_PREFIXES.indexOf(b.sheet_ref.trim().toUpperCase()[0] ?? "Z");
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  const selected = ranked.slice(0, 12);
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
  await admin
    .from("plan_reviews")
    .update({
      ai_check_status: "complete",
      pipeline_version: "v2",
      updated_at: new Date().toISOString(),
    })
    .eq("id", planReviewId);
  return { ok: true };
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

  const BATCH = 5;
  let upheld = 0;
  let overturned = 0;
  let modified = 0;
  let cannotLocate = 0;
  let skipped = 0;

  for (let start = 0; start < targets.length; start += BATCH) {
    const slice = targets.slice(start, start + BATCH);

    // Aggregate page indices across the batch (capped to keep payload tight).
    const pageSet = new Set<number>();
    for (const t of slice) for (const p of t.page_indices) pageSet.add(p);
    const pages = Array.from(pageSet).slice(0, 8);
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

  // Bucket by normalized FBC section. Findings with no section are bucketed
  // by their first sheet ref to still catch "same wall flagged twice".
  const buckets = new Map<string, typeof enriched>();
  for (const e of enriched) {
    const key = e.section
      ? `sec:${e.section}`
      : e.sheets.size > 0
        ? `sheet:${Array.from(e.sheets)[0]}`
        : null;
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
        if (jaccard(a.tokens, b.tokens) < 0.55) continue;
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

  const distinctSections = Array.from(
    new Set(
      defs
        .map((d) => keyOf(d))
        .filter((k): k is Key => !!k)
        .map((k) => k.section),
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

  function lookup(k: Key): Canon | null {
    // Exact (code, section, edition) → exact (code, section) → section-only.
    let hit =
      (k.edition &&
        canon.find(
          (c) =>
            c.code === k.code && c.section === k.section && c.edition === k.edition,
        )) ||
      null;
    if (!hit) hit = canon.find((c) => c.code === k.code && c.section === k.section) ?? null;
    if (!hit) hit = canon.find((c) => c.section === k.section) ?? null;
    return hit;
  }

  const counts = { verified: 0, mismatch: 0, not_found: 0, hallucinated: 0 };
  const now = new Date().toISOString();

  for (const def of defs) {
    const key = keyOf(def);
    let status: "verified" | "mismatch" | "not_found" | "hallucinated";
    let score: number | null = null;
    let canonText: string | null = null;

    if (!key) {
      // No parseable section at all = hallucinated/missing citation.
      status = "hallucinated";
    } else {
      const hit = lookup(key);
      if (!hit) {
        status = "not_found";
      } else {
        canonText = `${hit.code} ${hit.section} (${hit.edition}) — ${hit.title}: ${hit.requirement_text}`.slice(
          0,
          1500,
        );
        const aiBlob = `${def.finding} ${def.required_action}`;
        score = citationOverlapScore(aiBlob, hit.requirement_text);
        status = score >= 0.18 ? "verified" : "mismatch";
      }
    }
    counts[status]++;

    const { error: updErr } = await admin
      .from("deficiencies_v2")
      .update({
        citation_status: status,
        citation_match_score: score,
        citation_canonical_text: canonText,
        citation_grounded_at: now,
      })
      .eq("id", def.id);
    if (updErr) console.error("[ground_citations] update failed", def.id, updErr);
  }

  return {
    examined: defs.length,
    verified: counts.verified,
    mismatch: counts.mismatch,
    not_found: counts.not_found,
    hallucinated: counts.hallucinated,
  };
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

    const body = await req.json().catch(() => ({}));
    const plan_review_id = body?.plan_review_id;
    const startFrom: Stage | undefined = body?.start_from;
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

    // Determine which stages to run. When `start_from` is supplied (e.g. after
    // a manual DNA patch), we skip earlier stages but still substitute a cheap
    // `dna_extract` re-evaluation so the gate runs on the patched values.
    const startIdx = startFrom ? STAGES.indexOf(startFrom) : 0;
    const effectiveStart = startIdx < 0 ? 0 : startIdx;
    const stagesToRun = STAGES.slice(effectiveStart);

    // Mark all stages pending up-front so the stepper renders immediately.
    if (effectiveStart === 0) {
      for (const s of STAGES) {
        await setStage(admin, plan_review_id, firmId, s, { status: "pending" });
      }
    } else {
      for (const s of stagesToRun) {
        await setStage(admin, plan_review_id, firmId, s, { status: "pending" });
      }
    }

    const stageImpls: Record<Stage, () => Promise<Record<string, unknown>>> = {
      upload: () => stageUpload(admin, plan_review_id),
      sheet_map: () => stageSheetMap(admin, plan_review_id, firmId),
      dna_extract: () => stageDnaExtract(admin, plan_review_id, firmId),
      discipline_review: () => stageDisciplineReview(admin, plan_review_id, firmId),
      verify: () => stageVerify(admin, plan_review_id),
      dedupe: () => stageDedupe(admin, plan_review_id),
      ground_citations: () => stageGroundCitations(admin, plan_review_id),
      cross_check: () => stageCrossCheck(admin, plan_review_id, firmId),
      deferred_scope: () => stageDeferredScope(admin, plan_review_id, firmId),
      prioritize: () => stagePrioritize(admin, plan_review_id),
      complete: () => stageComplete(admin, plan_review_id),
    };

    const results: Record<string, unknown> = {};
    let halted = false;
    let haltReason: string | null = null;

    for (const stage of stagesToRun) {
      if (halted) {
        await setStage(admin, plan_review_id, firmId, stage, {
          status: "error",
          error_message: haltReason ?? "Skipped — earlier stage failed",
        });
        continue;
      }
      await setStage(admin, plan_review_id, firmId, stage, { status: "running" });
      try {
        // When re-running from a later stage, substitute a cheap re-evaluation
        // for the expensive vision-based extract so the gate still runs.
        const impl =
          stage === "dna_extract" && effectiveStart > 0
            ? () => stageDnaReevaluate(admin, plan_review_id)
            : stageImpls[stage];
        const meta = await withRetry(() => impl(), `stage:${stage}`);
        results[stage] = meta;
        await setStage(admin, plan_review_id, firmId, stage, {
          status: "complete",
          metadata: meta,
        });

        // DNA gate: block downstream stages if extraction is unreliable.
        if (stage === "dna_extract") {
          const m = meta as Partial<DnaHealth>;
          if (m.blocking) {
            halted = true;
            haltReason = `DNA gate: ${m.block_reason ?? "extraction blocked"}`;
            // Re-mark the dna_extract row with the block reason so the UI can surface it.
            await setStage(admin, plan_review_id, firmId, stage, {
              status: "error",
              error_message: haltReason,
              metadata: meta as Record<string, unknown>,
            });
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results[stage] = { error: message };
        await setStage(admin, plan_review_id, firmId, stage, {
          status: "error",
          error_message: message,
        });
        // 'upload' and 'dna_extract' are hard prerequisites — halt if they fail.
        if (stage === "upload" || stage === "dna_extract") {
          halted = true;
          haltReason = `${stage} failed: ${message}`;
        }
      }
    }

    return new Response(JSON.stringify({ ok: !halted, halt_reason: haltReason, results }), {
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
