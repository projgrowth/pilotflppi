// stages/checklist-sweep.ts — Residential-only deterministic checklist pass.
//
// Replaces `discipline_review` for residential projects. Instead of letting
// 5 expert personas freelance findings across an SFR, we walk the seeded
// FBCR checklist (`discipline_negative_space` rows where use_type='residential')
// and ask the model ONE narrow question per item:
//
//   "Looking only at these sheets, is FBCR §X met? compliant / deficient / not_visible"
//
// Guarantees:
//   - one finding per checklist item, max
//   - every checklist item gets a verdict (no missed items)
//   - the model can't invent topics outside the checklist
//   - citations are pre-grounded by the checklist row's fbc_section
//
// Items are processed in batches of CONCURRENCY to keep total wall time
// well under the edge function budget (~60-90s for ~43 items).

import type { Admin } from "../_shared/supabase.ts";
import { callAI } from "../_shared/ai.ts";
import { signedSheetUrls } from "../_shared/storage.ts";
import { mergeProgress, heartbeat } from "../_shared/pipeline-status.ts";

const VERDICT_SCHEMA = {
  name: "submit_checklist_verdict",
  description:
    "Return a single verdict for one FBCR checklist item, judged ONLY against the supplied sheets.",
  parameters: {
    type: "object",
    properties: {
      verdict: {
        type: "string",
        enum: ["compliant", "deficient", "not_visible", "not_applicable"],
      },
      finding: {
        type: "string",
        description:
          "One sentence. Empty string when verdict=compliant or not_applicable. For deficient, state the specific shortfall. For not_visible, state what was looked for and where.",
      },
      sheet_refs: { type: "array", items: { type: "string" } },
      evidence: { type: "string", description: "Short quote or visual cue." },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: ["verdict", "finding", "sheet_refs", "confidence"],
    additionalProperties: false,
  },
} as const;

interface ChecklistRow {
  id: string;
  item_key: string;
  description: string;
  fbc_section: string | null;
  trigger_condition: string | null;
  discipline: string;
  sheet_hints: { disciplines?: string[]; keywords?: string[] } | null;
}

interface SheetRow {
  sheet_ref: string;
  sheet_title: string | null;
  discipline: string | null;
  page_index: number | null;
}

const CONCURRENCY = 4;
const MAX_SHEETS_PER_ITEM = 4;

function selectSheetsFor(
  item: ChecklistRow,
  sheets: SheetRow[],
): SheetRow[] {
  const hints = item.sheet_hints ?? {};
  const wantDisciplines = (hints.disciplines ?? []).map((d) => d.toLowerCase());
  const wantKeywords = (hints.keywords ?? []).map((k) => k.toLowerCase());

  const scored = sheets.map((s) => {
    let score = 0;
    const disc = (s.discipline ?? "").toLowerCase();
    const title = (s.sheet_title ?? "").toLowerCase();
    if (wantDisciplines.includes(disc)) score += 10;
    for (const kw of wantKeywords) {
      if (title.includes(kw)) score += 3;
    }
    // Cover sheet bonus for items needing cover/notes
    if (
      (wantKeywords.includes("cover") || wantKeywords.includes("general notes")) &&
      (title.includes("cover") || title.includes("index") || title.includes("notes"))
    ) {
      score += 5;
    }
    return { s, score };
  });

  const matched = scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SHEETS_PER_ITEM)
    .map((x) => x.s);

  // Fallback: if no hint matches, use first sheet from preferred discipline
  // or just the first sheet, so the model still gets something to look at.
  if (matched.length === 0) {
    const first = sheets.find((s) =>
      wantDisciplines.includes((s.discipline ?? "").toLowerCase()),
    );
    return first ? [first] : sheets.slice(0, 1);
  }
  return matched;
}

export async function stageChecklistSweep(
  admin: Admin,
  planReviewId: string,
  firmId: string | null,
) {
  const [{ data: prMeta }, { data: sheetsRaw }, { data: dnaRow }, { data: itemsRaw }, signed] =
    await Promise.all([
      admin
        .from("plan_reviews")
        .select("projects(use_type, county)")
        .eq("id", planReviewId)
        .maybeSingle(),
      admin
        .from("sheet_coverage")
        .select("sheet_ref, sheet_title, discipline, page_index")
        .eq("plan_review_id", planReviewId)
        .eq("status", "present")
        .order("page_index", { ascending: true }),
      admin
        .from("project_dna")
        .select("occupancy_classification, fbc_edition, hvhz, county, total_sq_ft, stories")
        .eq("plan_review_id", planReviewId)
        .maybeSingle(),
      admin
        .from("discipline_negative_space")
        .select("id, item_key, description, fbc_section, trigger_condition, discipline, sheet_hints")
        .eq("use_type", "residential")
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
      signedSheetUrls(admin, planReviewId),
    ]);

  const useType =
    (prMeta as { projects?: { use_type?: string | null } | null } | null)
      ?.projects?.use_type ?? null;
  if (useType !== "residential") {
    return { skipped: true, reason: "not_residential" };
  }

  const sheets = (sheetsRaw ?? []) as SheetRow[];
  const items = (itemsRaw ?? []) as ChecklistRow[];
  const dna = (dnaRow ?? {}) as Record<string, unknown>;

  if (items.length === 0) {
    return { skipped: true, reason: "no_checklist_items" };
  }
  if (sheets.length === 0 || signed.length === 0) {
    return { skipped: true, reason: "no_sheets" };
  }

  // Build sheet_ref → signed_url map. signed[] is page-indexed (mirrors dna.ts).
  const urlBySheetRef = new Map<string, string>();
  for (const s of sheets) {
    if (typeof s.page_index === "number" && signed[s.page_index]?.signed_url) {
      urlBySheetRef.set(s.sheet_ref.toUpperCase(), signed[s.page_index].signed_url);
    }
  }

  const projectScope = JSON.stringify(
    {
      use_type: "residential",
      occupancy: dna.occupancy_classification ?? "R-3 (assumed)",
      fbc_edition: dna.fbc_edition ?? "8th",
      controlling_code: "FBC Residential 8th Edition (2023)",
      county: dna.county ?? null,
      hvhz: dna.hvhz ?? false,
      total_sq_ft: dna.total_sq_ft ?? null,
      stories: dna.stories ?? null,
    },
    null,
    2,
  );

  const systemPrompt =
    "You are a Florida private-provider plan reviewer auditing a single-family residential plan set against ONE specific FBC Residential 8th Edition (2023) requirement. " +
    "You may ONLY judge the requirement supplied in the user message — do not raise other issues. " +
    "Verdicts: 'compliant' (visibly met), 'deficient' (visibly missing or wrong), 'not_visible' (the requirement was not depicted on the supplied sheets — flag for human verify), 'not_applicable' (the requirement does not apply to this scope, e.g. flood detail when no flood zone). " +
    "Never cite a code other than FBCR. Be terse.";

  const verdicts: Array<{
    item: ChecklistRow;
    verdict: string;
    finding: string;
    sheet_refs: string[];
    evidence?: string;
    confidence: number;
  }> = [];

  const beat = () => heartbeat(admin, planReviewId).catch(() => undefined);

  async function runOne(item: ChecklistRow) {
    const candidateSheets = selectSheetsFor(item, sheets);
    const urls = candidateSheets
      .map((s) => urlBySheetRef.get(s.sheet_ref.toUpperCase()))
      .filter((u): u is string => !!u)
      .slice(0, MAX_SHEETS_PER_ITEM);

    if (urls.length === 0) {
      verdicts.push({
        item,
        verdict: "not_visible",
        finding: `No sheets matching this requirement were found in the submittal (looked for: ${(item.sheet_hints?.disciplines ?? []).join(", ") || "any"}).`,
        sheet_refs: [],
        confidence: 0.5,
      });
      return;
    }

    const userText =
      `PROJECT SCOPE:\n${projectScope}\n\n` +
      `REQUIREMENT TO JUDGE:\n` +
      `  Item: ${item.item_key}\n` +
      `  FBCR Section: ${item.fbc_section ?? "(unspecified)"}\n` +
      `  Description: ${item.description}\n` +
      (item.trigger_condition ? `  Only applies when: ${item.trigger_condition}\n` : "") +
      `\nSHEETS PROVIDED:\n` +
      candidateSheets
        .map((s) => `  ${s.sheet_ref}${s.sheet_title ? ` — ${s.sheet_title}` : ""}`)
        .join("\n") +
      `\n\nReturn one verdict via submit_checklist_verdict.`;

    try {
      const out = (await callAI(
        [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: userText },
              ...urls.map((u) => ({
                type: "image_url" as const,
                image_url: { url: u },
              })),
            ],
          },
        ],
        VERDICT_SCHEMA as unknown as Record<string, unknown>,
        "google/gemini-2.5-flash",
        0,
      )) as {
        verdict?: string;
        finding?: string;
        sheet_refs?: string[];
        evidence?: string;
        confidence?: number;
      };

      verdicts.push({
        item,
        verdict: out.verdict ?? "not_visible",
        finding: (out.finding ?? "").trim(),
        sheet_refs: Array.isArray(out.sheet_refs) ? out.sheet_refs : [],
        evidence: out.evidence,
        confidence:
          typeof out.confidence === "number" ? out.confidence : 0.5,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[checklist_sweep] ${item.item_key} failed:`, msg);
      verdicts.push({
        item,
        verdict: "not_visible",
        finding: `Automated check failed (${msg.slice(0, 80)}). Verify on plan.`,
        sheet_refs: candidateSheets.map((s) => s.sheet_ref),
        confidence: 0.3,
      });
    }
  }

  // Process in concurrency batches.
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(runOne));
    await beat();
  }

  // Convert verdicts → deficiencies_v2 rows. Skip compliant + not_applicable.
  const rowsToInsert = verdicts
    .filter((v) => v.verdict === "deficient" || v.verdict === "not_visible")
    .map((v, idx) => {
      const isNotVisible = v.verdict === "not_visible";
      const fbcSection = v.item.fbc_section ?? "FBCR";
      const priority = isNotVisible
        ? "low"
        : v.confidence >= 0.7
          ? "high"
          : "medium";
      return {
        plan_review_id: planReviewId,
        firm_id: firmId,
        def_number: `DEF-CL${String(idx + 1).padStart(3, "0")}`,
        discipline: v.item.discipline,
        sheet_refs: v.sheet_refs,
        code_reference: {
          code: "FBCR",
          section: fbcSection.replace(/^FBCR\s*/, ""),
          edition: (dna.fbc_edition as string | null) ?? "8th",
        },
        finding: v.finding ||
          `${v.item.description} — verify on plan (${fbcSection}).`,
        required_action: isNotVisible
          ? `Confirm that ${v.item.description.toLowerCase()} is shown on the plans, or provide a sheet/detail demonstrating compliance.`
          : `Revise plans to comply with ${fbcSection}: ${v.item.description}`,
        evidence: v.evidence ? [v.evidence] : [],
        priority,
        life_safety_flag:
          v.item.item_key === "smoke_alarms" ||
          v.item.item_key === "co_alarms" ||
          v.item.item_key === "eero" ||
          v.item.item_key === "egress_door" ||
          v.item.item_key === "guards" ||
          v.item.item_key === "stair_geometry",
        permit_blocker: !isNotVisible && v.confidence >= 0.7,
        liability_flag: false,
        requires_human_review: isNotVisible || v.confidence < 0.6,
        human_review_reason: isNotVisible
          ? "AI did not visually confirm this item on the supplied sheets — reviewer must verify."
          : v.confidence < 0.6
            ? "Low confidence — reviewer should confirm on plan."
            : null,
        human_review_verify: `Open ${v.sheet_refs.join(", ") || "relevant sheets"} and confirm ${fbcSection}.`,
        confidence_score: v.confidence,
        confidence_basis: `Checklist item ${v.item.item_key} (${v.verdict}). Judged against ${v.sheet_refs.length} sheet(s).`,
        status: "open",
        verification_status: "unverified",
        citation_status: "verified", // pre-grounded by checklist row
        verification_meta: {
          checklist_item_id: v.item.id,
          checklist_item_key: v.item.item_key,
          verdict: v.verdict,
        },
        model_version: "google/gemini-2.5-flash",
      };
    });

  if (rowsToInsert.length > 0) {
    const { error } = await admin
      .from("deficiencies_v2")
      .upsert(rowsToInsert, {
        onConflict: "plan_review_id,def_number",
        ignoreDuplicates: false,
      });
    if (error) throw error;
  }

  const summary = {
    total_items: items.length,
    compliant: verdicts.filter((v) => v.verdict === "compliant").length,
    deficient: verdicts.filter((v) => v.verdict === "deficient").length,
    not_visible: verdicts.filter((v) => v.verdict === "not_visible").length,
    not_applicable: verdicts.filter((v) => v.verdict === "not_applicable").length,
    findings_written: rowsToInsert.length,
  };

  await mergeProgress(admin, planReviewId, {
    checklist_sweep_at: new Date().toISOString(),
    checklist_sweep_summary: summary,
  });

  return summary;
}
