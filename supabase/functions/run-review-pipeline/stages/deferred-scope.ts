// Stage: deferred_scope.
// Vision-extracts deferred-submittal callouts (fire sprinkler shop drawings,
// pre-engineered trusses, kitchen hood, elevators, etc.) from the cover/
// general-notes sheets. Idempotent — re-runs are skipped if rows already exist.

import { createClient } from "../_shared/supabase.ts";
import { callAI } from "../_shared/ai.ts";
import { signedSheetUrls } from "../_shared/storage.ts";

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

export async function stageDeferredScope(
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

  // Pull general/cover sheets — that's where deferred-submittal lists almost
  // always live. Fall back to first 3 pages if no general sheets mapped.
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
