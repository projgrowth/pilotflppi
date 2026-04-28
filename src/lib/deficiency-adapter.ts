/**
 * Adapter: convert `deficiencies_v2` rows into the legacy `Finding[]` shape
 * the PlanReviewDetail viewer + CommentLetterExport expect.
 *
 * Two responsibilities:
 *   1. Reshape v2 columns → legacy Finding fields (severity, resolved, …).
 *   2. Compute a deterministic `markup` (page_index + pin x/y/w/h) by joining
 *      the row's first sheet_ref against the sheet_map snapshot stored at
 *      `plan_reviews.checklist_state.last_sheet_map`. Pin coordinates follow
 *      the rule in mem://logic/pin-placement: hash(finding.id + sheet_ref)
 *      → stable position so the same finding always lands in the same spot
 *      across renders without us storing per-flag coords in the DB.
 *
 * Without (2) the PlanMarkupViewer's `if (!finding.markup) return null;`
 * guard suppresses every pin and the viewer looks broken.
 */

import { normalizeDiscipline } from "@/lib/county-utils";
import type { Finding, MarkupData } from "@/types";

/** Subset of `deficiencies_v2` columns the adapter needs. */
export interface DeficiencyV2Lite {
  id: string;
  def_number: string;
  discipline: string;
  finding: string;
  required_action: string;
  sheet_refs: string[] | null;
  code_reference: { code?: string; section?: string; edition?: string } | null;
  evidence: string[] | null;
  confidence_score: number | null;
  confidence_basis: string | null;
  priority: string;
  life_safety_flag: boolean;
  permit_blocker: boolean;
  liability_flag: boolean;
  requires_human_review: boolean;
  human_review_reason: string | null;
  verification_status: string;
  /** Citation grounding result from the ground-citations stage:
   *  verified | verified_stub | mismatch | hallucinated | no_citation_required | unverified. */
  citation_status?: string | null;
  status: string;
  model_version: string | null;
  /** Signed URL of the cited sheet image, attached by the ground_citations stage. */
  evidence_crop_url?: string | null;
  /** `{ page_index, sheet_ref, signed_until, source, pinned? }` — the resolved
   *  page index here is more authoritative than the sheet_map fallback. */
  evidence_crop_meta?: Record<string, unknown> | null;
}

/** One row of the snapshot at `plan_reviews.checklist_state.last_sheet_map`. */
export interface SheetMapEntry {
  sheet_ref?: string;
  page_index?: number;
}

function severityFromV2(d: DeficiencyV2Lite): "critical" | "major" | "minor" {
  if (d.life_safety_flag || d.permit_blocker) return "critical";
  if (d.priority === "high") return "critical";
  if (d.priority === "medium") return "major";
  return "minor";
}

function codeRefFromV2(d: DeficiencyV2Lite): string {
  const cr = d.code_reference;
  if (!cr) return "";
  return [cr.code, cr.section, cr.edition && `(${cr.edition})`]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function resolvedFromV2(d: DeficiencyV2Lite): boolean {
  return d.status === "resolved" || d.status === "waived";
}

/** Cheap, stable 32-bit hash → keeps the same pin across renders/sessions. */
function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic pin placement on a page (normalized 0–1 coords).
 * Keeps pins inside a 0.10–0.90 inset so they never hug the trim edge.
 */
function deterministicPin(seed: string): Pick<MarkupData, "x" | "y" | "width" | "height"> {
  const h = hash32(seed);
  const x = 0.1 + ((h % 800) / 1000); // 0.10–0.90
  const y = 0.1 + (((h >>> 10) % 800) / 1000);
  return { x, y, width: 0.06, height: 0.04 };
}

/**
 * Build a sheet_ref → page_index map from the snapshot.
 * Tolerates uppercase/lowercase variation ("A101" vs "a101").
 */
function indexSheetMap(sheetMap: SheetMapEntry[] | null | undefined): Map<string, number> {
  const m = new Map<string, number>();
  if (!sheetMap) return m;
  for (const row of sheetMap) {
    if (!row?.sheet_ref || typeof row.page_index !== "number") continue;
    m.set(row.sheet_ref.toUpperCase().trim(), row.page_index);
  }
  return m;
}

/**
 * Convert a list of v2 deficiencies into the legacy Finding[] shape.
 *
 * @param rows     deficiencies_v2 rows for this plan review
 * @param sheetMap optional sheet snapshot from
 *                 `plan_reviews.checklist_state.last_sheet_map`. Pass it so
 *                 each finding gets a deterministic pin on the right page.
 */
export function adaptV2ToFindings(
  rows: DeficiencyV2Lite[],
  sheetMap?: SheetMapEntry[] | null,
): Finding[] {
  const sheetIndex = indexSheetMap(sheetMap);

  return rows.map((d) => {
    const sheets = d.sheet_refs ?? [];
    const firstSheet = sheets[0] ?? "";
    const reasoning = [
      d.confidence_basis ?? "",
      d.requires_human_review && d.human_review_reason
        ? `\n\nHuman review needed: ${d.human_review_reason}`
        : "",
    ]
      .join("")
      .trim();

    // Pin placement priority:
    //   1. Real bbox stored in evidence_crop_meta (set by an upstream
    //      vision/crop pass or by a human reposition). High confidence.
    //   2. Resolved page_index from evidence_crop_meta + deterministic xy.
    //      Medium confidence — page is right, position is hashed.
    //   3. Fall back to the sheet_map snapshot lookup + deterministic xy.
    //      Low confidence — last-resort so the pin still appears.
    let markup: MarkupData | undefined;
    const meta = (d.evidence_crop_meta ?? {}) as Record<string, unknown>;
    const metaPage = typeof meta.page_index === "number" ? meta.page_index : null;
    const metaBbox =
      typeof meta.x === "number" &&
      typeof meta.y === "number" &&
      typeof meta.w === "number" &&
      typeof meta.h === "number"
        ? { x: meta.x as number, y: meta.y as number, w: meta.w as number, h: meta.h as number }
        : null;
    const userPinned = meta.pinned === true || meta.user_repositioned === true;

    if (metaPage !== null && metaBbox) {
      markup = {
        page_index: metaPage,
        x: metaBbox.x,
        y: metaBbox.y,
        width: metaBbox.w,
        height: metaBbox.h,
        pin_confidence: userPinned ? "high" : "medium",
        user_repositioned: userPinned,
      };
    } else if (metaPage !== null) {
      const { x, y, width, height } = deterministicPin(`${d.id}|${firstSheet}`);
      markup = {
        page_index: metaPage,
        x,
        y,
        width,
        height,
        pin_confidence: "low",
      };
    } else if (firstSheet) {
      const pageIndex = sheetIndex.get(firstSheet.toUpperCase().trim());
      if (typeof pageIndex === "number") {
        const { x, y, width, height } = deterministicPin(`${d.id}|${firstSheet}`);
        markup = {
          page_index: pageIndex,
          x,
          y,
          width,
          height,
          pin_confidence: "low",
        };
      }
    }

    return {
      finding_id: d.id,
      severity: severityFromV2(d),
      discipline: normalizeDiscipline(d.discipline),
      code_ref: codeRefFromV2(d),
      page: firstSheet,
      description: d.finding,
      recommendation: d.required_action,
      confidence:
        d.confidence_score === null
          ? undefined
          : d.confidence_score >= 0.85
            ? "high"
            : d.confidence_score >= 0.6
              ? "medium"
              : "low",
      reasoning: reasoning || undefined,
      resolved: resolvedFromV2(d),
      model_version: d.model_version ?? undefined,
      evidence_crop_url: d.evidence_crop_url ?? null,
      verification_status: d.verification_status ?? null,
      citation_status: d.citation_status ?? null,
      markup,
    };
  });
}
