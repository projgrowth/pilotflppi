// stages/submittal-check.ts — submittal completeness gate.
//
// Run BEFORE DNA / discipline review. If a commercial set has zero sheets
// for a required trade (Structural / MEP / Civil / Fire Protection) we
// raise ONE permit-blocker finding instead of letting discipline_review
// burn dozens of arch-only findings against an obviously incomplete set.

import type { Admin } from "../_shared/supabase.ts";
import { mergeProgress } from "../_shared/pipeline-status.ts";

export async function stageSubmittalCheck(
  admin: Admin,
  planReviewId: string,
  firmId: string | null,
) {
  const [prRowRes, dnaRowRes, coverageRes] = await Promise.all([
    admin
      .from("plan_reviews")
      .select("ai_run_progress, firm_id, projects(use_type)")
      .eq("id", planReviewId)
      .maybeSingle(),
    admin
      .from("project_dna")
      .select("occupancy_classification, construction_type")
      .eq("plan_review_id", planReviewId)
      .maybeSingle(),
    admin
      .from("sheet_coverage")
      .select("discipline")
      .eq("plan_review_id", planReviewId)
      .eq("status", "present"),
  ]);
  const prRow = prRowRes.data;
  const progress = ((prRow?.ai_run_progress ?? {}) as Record<string, unknown>) ?? {};
  if (progress.submittal_check_at) {
    return { reused: true, submittal_incomplete: !!progress.submittal_incomplete };
  }
  const useType =
    (prRow as { projects?: { use_type?: string | null } | null } | null)
      ?.projects?.use_type ?? null;
  const resolvedFirmId =
    firmId ?? ((prRow as { firm_id?: string | null } | null)?.firm_id ?? null);
  const occupancy = ((dnaRowRes.data as { occupancy_classification?: string | null } | null)
    ?.occupancy_classification ?? "").toString().toUpperCase().trim();

  const counts = new Map<string, number>();
  for (const row of (coverageRes.data ?? []) as Array<{ discipline: string | null }>) {
    const d = (row.discipline ?? "General").trim();
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const totalSheets = Array.from(counts.values()).reduce((a, b) => a + b, 0);

  // Atomic merge so a concurrent discipline_review heartbeat or dispatch
  // self-update can't clobber our completion marker.
  const writeProgress = (extra: Record<string, unknown>) =>
    mergeProgress(admin, planReviewId, {
      submittal_check_at: new Date().toISOString(),
      ...extra,
    });

  if (useType === "residential" || totalSheets < 6) {
    await writeProgress({
      submittal_incomplete: false,
      submittal_check_reason: "skipped_residential_or_small",
    });
    return { skipped: true, total_sheets: totalSheets };
  }

  // Per-occupancy expectation matrix. Anchored to FBC 8th Ed. Group letters
  // are matched against the leading character of the occupancy code (e.g.
  // "B", "M", "A-2", "I-2"). Falls back to a generic commercial baseline
  // when DNA hasn't classified yet.
  type Expect = { label: string; matchAny: string[] };
  const baseline: Expect[] = [
    { label: "Structural", matchAny: ["Structural"] },
    { label: "MEP / Mechanical / Electrical / Plumbing", matchAny: ["MEP"] },
    { label: "Civil / Site", matchAny: ["Civil"] },
    { label: "Fire Protection", matchAny: ["Fire Protection", "Life Safety"] },
  ];
  const occupancyExtras: Record<string, Expect[]> = {
    // Assembly — egress + life safety are dominant; fire protection mandatory.
    A: [{ label: "Life Safety / Egress Plan", matchAny: ["Life Safety", "Fire Protection"] }],
    // Educational — same as Assembly plus Civil for site security.
    E: [{ label: "Life Safety / Egress Plan", matchAny: ["Life Safety", "Fire Protection"] }],
    // Institutional — life safety + smoke compartments mandatory.
    I: [
      { label: "Life Safety / Egress Plan", matchAny: ["Life Safety", "Fire Protection"] },
      { label: "Smoke Compartment / Fire-Rated Assemblies", matchAny: ["Fire Protection", "Life Safety"] },
    ],
    // High-hazard — hazardous materials inventory + mechanical exhaust.
    H: [{ label: "Hazardous Materials / HMIS", matchAny: ["MEP", "Fire Protection"] }],
    // Mercantile / Business / Storage — baseline is sufficient, no extras.
  };
  const groupLetter = occupancy ? occupancy.charAt(0) : "";
  const expected: Expect[] = [...baseline, ...(occupancyExtras[groupLetter] ?? [])];

  const missing = expected.filter(
    (e) => !e.matchAny.some((d) => (counts.get(d) ?? 0) > 0),
  );
  const presentSummary = Array.from(counts.entries())
    .map(([d, n]) => `${d} (${n})`)
    .join(", ");
  const presentList = Array.from(counts.entries()).map(([d, n]) => ({
    discipline: d,
    sheets: n,
  }));

  if (missing.length === 0) {
    await writeProgress({
      submittal_incomplete: false,
      submittal_disciplines_present: presentList,
      submittal_occupancy: occupancy || null,
    });
    return { complete: true, total_sheets: totalSheets, occupancy: occupancy || null };
  }

  const missingLabels = missing.map((m) => m.label).join(", ");
  const occupancyClause = occupancy
    ? ` Per FBC 8th Ed. for occupancy classification ${occupancy}, the following are typically required:`
    : ` For commercial permits, the following disciplines are typically required:`;
  await admin.from("deficiencies_v2").upsert(
    {
      plan_review_id: planReviewId,
      firm_id: resolvedFirmId,
      def_number: "DEF-SUB001",
      discipline: "General",
      sheet_refs: [],
      code_reference: { code: "FBC", section: "107.2.1", edition: "8th" },
      finding:
        `Submittal appears incomplete for permit. The uploaded set contains ${totalSheets} sheet(s) covering: ${presentSummary}.` +
        `${occupancyClause} ${missingLabels} — none were found in the upload. ` +
        `Confirm with the design team whether the missing trades will be submitted under separate cover or whether this submittal should be returned as incomplete.`,
      required_action:
        `Either (a) request the missing discipline drawings (${missingLabels}) before continuing review, ` +
        `or (b) confirm in writing that the missing trades are deferred and document the deferral in the comment letter. ` +
        `If proceeding with review of the partial set, the comment letter must explicitly state that this review covers only the disciplines provided.`,
      evidence: [`Sheet inventory: ${presentSummary}`, occupancy ? `Occupancy: ${occupancy}` : `Occupancy: unclassified`],
      priority: "high",
      life_safety_flag: false,
      permit_blocker: true,
      liability_flag: true,
      requires_human_review: true,
      human_review_reason:
        "Missing-trade detection is heuristic — verify the contractor isn't sending the other trades under a separate permit number before rejecting.",
      human_review_verify:
        "Check project intake notes / contractor email for any reference to a deferred submittal or separate permit application.",
      confidence_score: 0.95,
      confidence_basis: "Deterministic — based on sheet_coverage discipline counts after sheet_map, gated by occupancy classification.",
      status: "open",
      verification_status: "unverified",
      citation_status: "unverified",
    },
    { onConflict: "plan_review_id,def_number" },
  );

  await writeProgress({
    submittal_incomplete: true,
    submittal_missing_disciplines: missing.map((m) => m.label),
    submittal_disciplines_present: presentList,
    submittal_occupancy: occupancy || null,
  });

  return {
    complete: false,
    total_sheets: totalSheets,
    occupancy: occupancy || null,
    missing: missing.map((m) => m.label),
  };
}
