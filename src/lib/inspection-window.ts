/**
 * F.S. 553.791(8) inspection-window helpers.
 *
 * Lives next to statutory-deadlines.ts and reuses its business-day logic
 * (FL state holidays, weekends). Kept in its own file so we don't bloat
 * statutory-deadlines.ts with inspection-only concerns.
 */

import { isBusinessDay } from "@/lib/statutory-deadlines";

/** Default per F.S. 553.791(8): 10 business days from contractor request. */
export const DEFAULT_INSPECTION_WINDOW_DAYS = 10;

/**
 * Given the timestamp the contractor requested an inspection, returns the
 * statutory deadline by which the private provider must perform it.
 */
export function computeInspectionWindow(
  requestedAt: string | Date | null | undefined,
  windowDays: number = DEFAULT_INSPECTION_WINDOW_DAYS,
): Date | null {
  if (!requestedAt) return null;
  const start = typeof requestedAt === "string" ? new Date(requestedAt) : requestedAt;
  if (Number.isNaN(start.getTime())) return null;

  const current = new Date(start);
  let added = 0;
  while (added < windowDays) {
    current.setDate(current.getDate() + 1);
    if (isBusinessDay(current)) added++;
  }
  return current;
}

/** Returns business-days remaining (negative when overdue). */
export function getInspectionDaysRemaining(
  requestedAt: string | Date | null | undefined,
  windowDays: number = DEFAULT_INSPECTION_WINDOW_DAYS,
  asOf: Date = new Date(),
): number | null {
  const deadline = computeInspectionWindow(requestedAt, windowDays);
  if (!deadline) return null;

  // Count business days between asOf and deadline (signed).
  const dir = deadline > asOf ? 1 : -1;
  const a = dir === 1 ? asOf : deadline;
  const b = dir === 1 ? deadline : asOf;

  let count = 0;
  const current = new Date(a);
  current.setDate(current.getDate() + 1);
  while (current <= b) {
    if (isBusinessDay(current)) count++;
    current.setDate(current.getDate() + 1);
  }
  return dir * count;
}
