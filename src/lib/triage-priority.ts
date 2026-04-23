import type { DeficiencyV2Row } from "@/hooks/useReviewDashboard";

/**
 * Triage priority score — lower number sorts first. We bucket findings by
 * urgency so reviewers always see the most consequential items first.
 *
 * Buckets:
 *   0  requires_human_review       (the AI explicitly flagged "needs eyes")
 *   1  life_safety_flag            (egress, fire-rated, occupancy)
 *   2  permit_blocker              (will halt issuance)
 *   3  liability_flag              (firm exposure)
 *   4  low confidence < 0.65       (AI itself uncertain)
 *   5  high priority               (string priority field)
 *   6  medium priority
 *   7  everything else
 *
 * Already-reviewed findings (reviewer_disposition !== null) are pushed to
 * the bottom of their bucket so the queue auto-collapses as work progresses.
 */
export function triagePriorityScore(d: DeficiencyV2Row): number {
  const reviewedPenalty = d.reviewer_disposition !== null ? 100 : 0;
  if (d.requires_human_review) return 0 + reviewedPenalty;
  if (d.life_safety_flag) return 1 + reviewedPenalty;
  if (d.permit_blocker) return 2 + reviewedPenalty;
  if (d.liability_flag) return 3 + reviewedPenalty;
  if (typeof d.confidence_score === "number" && d.confidence_score < 0.65)
    return 4 + reviewedPenalty;
  if (d.priority === "high") return 5 + reviewedPenalty;
  if (d.priority === "medium") return 6 + reviewedPenalty;
  return 7 + reviewedPenalty;
}

/** Sort a list in-place-safe (returns new array) by triage priority. */
export function sortByTriagePriority(items: DeficiencyV2Row[]): DeficiencyV2Row[] {
  return [...items].sort((a, b) => {
    const sa = triagePriorityScore(a);
    const sb = triagePriorityScore(b);
    if (sa !== sb) return sa - sb;
    // Tie-breaker: higher confidence first within the same bucket so the
    // reviewer can blast through high-confidence items quickly.
    const ca = a.confidence_score ?? 0;
    const cb = b.confidence_score ?? 0;
    if (ca !== cb) return cb - ca;
    return a.def_number.localeCompare(b.def_number, undefined, { numeric: true });
  });
}

/**
 * Group findings by sheet for the "Bulk-confirm by sheet" UX. Only sheets
 * where every item is high-confidence and not flagged are eligible.
 */
export interface SheetBulkGroup {
  sheet: string;
  items: DeficiencyV2Row[];
  eligibleForBulkConfirm: boolean;
}

const BULK_CONFIDENCE_FLOOR = 0.85;

export function groupBySheetForBulkConfirm(items: DeficiencyV2Row[]): SheetBulkGroup[] {
  const map = new Map<string, DeficiencyV2Row[]>();
  for (const d of items) {
    const sheet = (d.sheet_refs ?? [])[0]?.toUpperCase() ?? "—";
    if (!map.has(sheet)) map.set(sheet, []);
    map.get(sheet)!.push(d);
  }
  const groups: SheetBulkGroup[] = [];
  for (const [sheet, list] of map) {
    const allUnreviewed = list.every((d) => d.reviewer_disposition === null);
    const allConfident = list.every(
      (d) => typeof d.confidence_score === "number" && d.confidence_score >= BULK_CONFIDENCE_FLOOR,
    );
    const noneFlagged = list.every(
      (d) =>
        !d.requires_human_review &&
        !d.life_safety_flag &&
        !d.permit_blocker &&
        !d.liability_flag,
    );
    groups.push({
      sheet,
      items: list,
      eligibleForBulkConfirm:
        allUnreviewed && allConfident && noneFlagged && list.length >= 2,
    });
  }
  // Eligible groups float to the top — they're the easy wins.
  return groups.sort((a, b) => {
    if (a.eligibleForBulkConfirm !== b.eligibleForBulkConfirm)
      return a.eligibleForBulkConfirm ? -1 : 1;
    return a.sheet.localeCompare(b.sheet, undefined, { numeric: true });
  });
}
