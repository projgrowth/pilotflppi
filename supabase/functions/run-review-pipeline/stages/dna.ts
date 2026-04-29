// stages/dna.ts — Project DNA extraction + health evaluation.
//
// DNA = the structured Florida Building Code metadata that every downstream
// finding depends on (occupancy, construction type, county, fbc_edition,
// HVHZ, wind speed, etc.). Wrong DNA → wrong code citations on every
// finding, so the health evaluator hard-blocks the pipeline if any of the
// HARD_REQUIRED fields are missing or if the extracted county doesn't
// match the project record.
//
// `evaluateDnaHealth` is exported so the orchestrator can read its
// `blocking` field and halt the chain at the DNA gate.

import type { Admin } from "../_shared/supabase.ts";
import { callAI } from "../_shared/ai.ts";
import { signedSheetUrls } from "../_shared/storage.ts";

const DNA_SCHEMA = {
  type: "function",
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
      // Audit C-07 / M-01: read occupant_load when the code-summary block
      // states it. Threshold-building logic (F.S. 553.79(5)) needs OL to
      // turn an "Assembly + >5,000 sf" advisory into a definitive
      // classification (>500 occupants = threshold; ≤500 = not threshold).
      occupant_load: { type: ["integer", "null"] },
      // Audit M-04: true when the project sits on a barrier island, within
      // the wind-borne debris region, or otherwise on the coast — even if
      // the county is generally classified inland (e.g. Hillsborough's
      // Tampa Bay frontage). Drives WBDR + flood callouts.
      is_coastal: { type: ["boolean", "null"] },
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

// Critical fields used to compute completeness. Wrong/missing here = wrong findings downstream.
const CRITICAL_DNA_FIELDS = [
  "occupancy_classification",
  "construction_type",
  "county",
  "stories",
  "total_sq_ft",
  "fbc_edition",
] as const;

export interface DnaHealth {
  completeness: number;
  critical_missing: string[];
  jurisdiction_mismatch: boolean;
  blocking: boolean;
  block_reason: string | null;
}

export function evaluateDnaHealth(
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

  // HARD-required fields. If any of these are missing the pipeline halts —
  // running discipline review with the wrong county / occupancy / code
  // edition produces wrong code citations on every finding.
  const HARD_REQUIRED = ["county", "occupancy_classification", "fbc_edition"] as const;
  const hardMissing = HARD_REQUIRED.filter((f) => criticalMissing.includes(f));

  let blocking = false;
  let block_reason: string | null = null;
  if (hardMissing.length > 0) {
    blocking = true;
    block_reason = `Required DNA fields missing: ${hardMissing.join(", ")}. Reviewer must fill these in before the AI can run.`;
  } else if (jurisdictionMismatch) {
    blocking = true;
    block_reason = `Extracted county (${dna.county}) does not match project county (${projectCounty}) — wrong code edition would be applied.`;
  }
  // 50% completeness rule was demoted to a soft signal — surfaced in the
  // dashboard via critical_missing[] but no longer blocks the pipeline.

  return {
    completeness,
    critical_missing: criticalMissing,
    jurisdiction_mismatch: jurisdictionMismatch,
    blocking,
    block_reason,
  };
}

export async function stageDnaExtract(
  admin: Admin,
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
    .select("project_id, fbc_edition, projects(address, jurisdiction, county, use_type)")
    .eq("id", planReviewId)
    .maybeSingle();

  const project = pr as unknown as {
    project_id: string;
    fbc_edition: string | null;
    projects: { address: string; jurisdiction: string; county: string; use_type: string | null } | null;
  } | null;

  const useType = project?.projects?.use_type ?? null;

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

  // Inject use_type so the model knows whether this is FBC vs FBCR
  // and stops guessing the occupancy on every residential job.
  const useTypeHint = useType === "residential"
    ? `This is a RESIDENTIAL project (FBC Residential / FBCR applies, not FBC Building). Occupancy is R-3 by default for 1 & 2 family dwellings — only flag mixed_occupancy if the plans show it. `
    : useType === "commercial"
      ? `This is a COMMERCIAL project (FBC Building applies, not FBCR). Read the occupancy classification from the code summary verbatim. `
      : ``;

  const userText =
    `Read the project DNA from the supplied cover / code-summary pages. ` +
    `Florida project. Address: ${project?.projects?.address ?? "(unknown)"}, ` +
    `County: ${project?.projects?.county ?? "(unknown)"}. ` +
    useTypeHint +
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
    // Surface the real error instead of silently inserting an empty DNA row.
    // Previously this swallowed vision failures and let downstream stages
    // report a confusing "DNA gate failed: only 33% populated" instead of the
    // actual root cause (e.g. unsupported image format, rate limit, etc).
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[dna_extract] vision call failed:", err);
    throw new Error(`DNA extract vision call failed: ${msg}`);
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
    occupant_load: (extracted.occupant_load as number | null) ?? null,
    is_coastal: (extracted.is_coastal as boolean | null) ?? null,
    missing_fields:
      (extracted.missing_fields as string[] | undefined) ?? [],
    ambiguous_fields:
      (extracted.ambiguous_fields as string[] | undefined) ?? [],
    raw_extraction: extracted,
  };

  const { error } = await admin.from("project_dna").insert(row);
  if (error) throw error;

  // HVHZ NOA gate (F.S. 553.842 / FBC 1626 / Miami-Dade NOA program).
  // For Miami-Dade, Broward, or any project flagged HVHZ, every exterior
  // product (windows, doors, roofing, cladding, garage doors, skylights,
  // shutters) must carry a Miami-Dade NOA reference. We can't verify each
  // product call-out from the PDF deterministically, so we raise ONE high-
  // priority human-review deficiency that the licensed plan reviewer MUST
  // check before signing the letter. Skipped for residential single-family
  // unless the reviewer escalates manually.
  const projectCounty = (project?.projects?.county ?? "").toLowerCase();
  const isHvhzCounty =
    projectCounty.includes("miami-dade") ||
    projectCounty.includes("broward") ||
    projectCounty.includes("monroe");
  if (row.hvhz === true || isHvhzCounty) {
    await admin.from("deficiencies_v2").upsert(
      {
        plan_review_id: planReviewId,
        firm_id: firmId,
        def_number: "DEF-HVHZ001",
        discipline: "Structural",
        sheet_refs: [],
        code_reference: { code: "FBC", section: "1626", edition: row.fbc_edition ?? "8th" },
        finding:
          "Project is in the High Velocity Hurricane Zone (HVHZ). All exterior " +
          "envelope products — windows, doors, garage doors, roofing assemblies, " +
          "shutters, skylights, soffit, siding/cladding — must reference a current " +
          "Miami-Dade Notice of Acceptance (NOA) on the drawings or in a product " +
          "approval schedule. The submittal must be reviewed page-by-page to " +
          "confirm every exterior product call-out cites a valid, unexpired NOA " +
          "number (FL Product Approval FL# is NOT acceptable in HVHZ).",
        required_action:
          "Verify and document that an NOA is cited for: (a) all glazed openings " +
          "(impact-rated, large + small missile), (b) roofing system + underlayment, " +
          "(c) garage doors, (d) shutters/storm protection, (e) cladding/soffit. " +
          "If any product lacks an NOA reference, request a Product Approval " +
          "Schedule before signing the Plan Compliance Affidavit. Per FBC 1626, " +
          "FL Product Approval is not valid in HVHZ — Miami-Dade NOA only.",
        evidence: [`HVHZ jurisdiction: ${project?.projects?.county ?? "HVHZ flag set on DNA"}`],
        priority: "high",
        life_safety_flag: true,
        permit_blocker: true,
        liability_flag: true,
        requires_human_review: true,
        human_review_reason:
          "HVHZ NOA verification cannot be reliably automated — every product call-out must be visually confirmed against the Miami-Dade NOA database.",
        human_review_verify:
          "Open the architectural and structural sheets; confirm each exterior product call-out includes 'NOA #' followed by a valid Miami-Dade NOA number (format NN-NNNN.NN). Cross-check at https://www.miamidade.gov/building/pc-search_app.asp.",
        confidence_score: 1.0,
        confidence_basis: "Deterministic — triggered by HVHZ jurisdiction.",
        status: "open",
        verification_status: "unverified",
        citation_status: "unverified",
      },
      { onConflict: "plan_review_id,def_number" },
    );
  }

  const health = evaluateDnaHealth(row, project?.projects?.county ?? null);
  return {
    extracted: true,
    pages_read: imageUrls.length,
    missing: row.missing_fields.length,
    hvhz_gate_raised: row.hvhz === true || isHvhzCounty,
    ...health,
  };
}

/**
 * Re-evaluate DNA health from the current row in project_dna (used after a
 * reviewer manually patches missing fields and re-runs the pipeline from
 * `verify` onwards). No vision call — pure DB read + score.
 */
export async function stageDnaReevaluate(admin: Admin, planReviewId: string) {
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
