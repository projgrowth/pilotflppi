// stages/sheet-map.ts — vision-extract the title block of every page so
// downstream stages can route work to the right discipline reviewer.
//
// EXPECTED_SHEETS_BY_DISCIPLINE was removed in a prior pass — the heuristic
// fired missing_critical rows for every project regardless of scope (e.g.
// TIs without structural work always flagged S-001/S-101 as missing). The
// discipline_review stage handles scope awareness: if no sheets route to a
// discipline, it raises a human-review finding.

import type { Admin } from "../_shared/supabase.ts";
import { callAI } from "../_shared/ai.ts";
import { signedSheetUrls } from "../_shared/storage.ts";

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
              // "Other" removed: sheet_map already coerces unknowns to
              // "General", and giving the model two synonyms produced
              // inconsistent labels.
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

export async function stageSheetMap(
  admin: Admin,
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

  // Smaller batches keep memory under the worker's budget — 8 images at
  // ~150 DPI was enough to OOM on larger plan sets.
  const BATCH = 4;
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
        0,
      )) as {
        sheets: Array<{
          page_index: number;
          sheet_ref: string;
          sheet_title?: string;
          discipline: string;
        }>;
      };
      const returnedIndices = new Set((result?.sheets ?? []).map((s) => s.page_index));
      for (const s of result?.sheets ?? []) {
        present.push({
          page_index: s.page_index,
          sheet_ref: (s.sheet_ref || `X-${s.page_index}`).toUpperCase().slice(0, 32),
          sheet_title: s.sheet_title?.slice(0, 200) ?? null,
          discipline: s.discipline ?? "General",
        });
      }
      // Backfill any pages the model skipped (e.g. blank sheets) so downstream
      // signedUrls[page_index] lookups never silently return undefined.
      for (let i = start; i < start + slice.length; i++) {
        if (!returnedIndices.has(i)) {
          present.push({ page_index: i, sheet_ref: `X-${i}`, sheet_title: null, discipline: "General" });
        }
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

  // No hardcoded expected-sheets heuristic — scope varies per project.
  const allRows = [...presentRows];
  if (allRows.length === 0) return { sheets: 0 };
  const { error } = await admin.from("sheet_coverage").insert(allRows);
  if (error) throw error;

  // Round-2 diff: compute a lightweight signature for each present sheet so
  // the next run can tell which sheets actually changed. Signature is
  // sheet_ref + page_index + storage_path (storage_path changes when the
  // raster bytes change because the upload writes a content-keyed path).
  // Deferred to checklist_state.last_sheet_map at end-of-run; we just stage
  // the in-memory snapshot here for any caller that wants it.
  const snapshot = present.map((p) => ({
    sheet_ref: p.sheet_ref,
    page_index: p.page_index,
    discipline: p.discipline,
  }));
  return {
    sheets: allRows.length,
    present: presentRows.length,
    snapshot,
  };
}
