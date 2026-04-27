// Stage: cross_check.
// Three sub-passes:
//   1. Duplicate detection — same FBC section + same sheet flagged twice.
//   2. Contradiction detection — a finding this round was previously
//      resolved/waived in a prior round (suggests round regression).
//   3. Cross-sheet AI vision pass — door schedule vs floor plan, occupant
//      load sums, panel schedules vs riser, etc. Mismatches that are only
//      visible by reading TWO sheets together. Persisted as DEF-XS* rows.

import { createClient } from "../_shared/supabase.ts";
import { callAI } from "../_shared/ai.ts";
import { signedSheetUrls } from "../_shared/storage.ts";

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
                "accessibility_clearance_vs_plan",
                "roof_uplift_vs_truss_layout",
                "other",
              ],
            },
            description: { type: "string" },
            sheet_a: { type: "string" },
            value_a: { type: "string" },
            sheet_b: { type: "string" },
            value_b: { type: "string" },
            evidence: { type: "array", items: { type: "string" } },
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

  // Round-robin across discipline prefixes so cross-discipline coverage is
  // guaranteed even on Architectural-heavy sets.
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
    discipline: "cross_sheet",
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
    return mismatches;
  }

  return mismatches.map((m, i) => ({
    ...m,
    deficiency_id: (inserted?.[i] as { id: string } | undefined)?.id,
    def_number: (inserted?.[i] as { def_number: string } | undefined)?.def_number,
  }));
}

export async function stageCrossCheck(
  admin: ReturnType<typeof createClient>,
  planReviewId: string,
  firmId: string | null,
) {
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
  const groupMap = new Map<string, DuplicateGroup>();
  for (const d of rows) {
    const section = (d.code_reference?.section ?? "").trim().toLowerCase();
    if (!section) continue;
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
  const { data: prevRows } = await admin
    .from("plan_reviews")
    .select("round, previous_findings")
    .eq("id", planReviewId)
    .maybeSingle();
  const prev = prevRows as { round: number; previous_findings: unknown } | null;

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
        break;
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
