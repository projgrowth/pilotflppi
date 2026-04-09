/**
 * F.S. 553.791 Statutory Deadline Utilities
 * 
 * Calculates business-day deadlines for Florida Private Provider Act compliance.
 * - 30 business-day plan review window
 * - 10 business-day inspection window
 * Excludes weekends per F.S. 553.791(4).
 */

export function isBusinessDay(date: Date): boolean {
  const day = date.getDay();
  return day !== 0 && day !== 6; // Not Sunday or Saturday
}

export function getBusinessDaysElapsed(startDate: string | null): number {
  if (!startDate) return 0;
  const start = new Date(startDate);
  const now = new Date();
  let count = 0;
  const current = new Date(start);
  current.setDate(current.getDate() + 1); // Start counting from next day

  while (current <= now) {
    if (isBusinessDay(current)) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

export function getBusinessDaysRemaining(
  startDate: string | null,
  totalBusinessDays: number
): number {
  const elapsed = getBusinessDaysElapsed(startDate);
  return Math.max(0, totalBusinessDays - elapsed);
}

export function getStatutoryDeadlineDate(
  startDate: string | null,
  totalBusinessDays: number
): Date | null {
  if (!startDate) return null;
  const start = new Date(startDate);
  let daysAdded = 0;
  const current = new Date(start);

  while (daysAdded < totalBusinessDays) {
    current.setDate(current.getDate() + 1);
    if (isBusinessDay(current)) daysAdded++;
  }
  return current;
}

export type StatutoryPhase = "review" | "inspection" | "complete" | "none";

export interface StatutoryStatus {
  phase: StatutoryPhase;
  reviewDaysUsed: number;
  reviewDaysTotal: number;
  reviewDaysRemaining: number;
  inspectionDaysUsed: number;
  inspectionDaysTotal: number;
  inspectionDaysRemaining: number;
  isOverdue: boolean;
  clockRunning: boolean;
}

export function getStatutoryStatus(project: {
  status: string;
  review_clock_started_at?: string | null;
  review_clock_paused_at?: string | null;
  statutory_review_days?: number | null;
  statutory_inspection_days?: number | null;
  notice_filed_at?: string | null;
}): StatutoryStatus {
  const reviewDays = project.statutory_review_days ?? 30;
  const inspectionDays = project.statutory_inspection_days ?? 10;
  const clockStart = project.review_clock_started_at || project.notice_filed_at;
  const isPaused = !!project.review_clock_paused_at;

  const inspectionStatuses = ["inspection_scheduled", "inspection_complete"];
  const completedStatuses = ["certificate_issued", "cancelled"];
  const reviewStatuses = ["intake", "plan_review", "comments_sent", "resubmitted", "approved", "permit_issued"];

  let phase: StatutoryPhase = "none";
  if (completedStatuses.includes(project.status)) {
    phase = "complete";
  } else if (inspectionStatuses.includes(project.status)) {
    phase = "inspection";
  } else if (reviewStatuses.includes(project.status)) {
    phase = "review";
  }

  const effectiveStart = isPaused ? project.review_clock_paused_at! : clockStart;
  const reviewDaysUsed = phase === "review" ? getBusinessDaysElapsed(effectiveStart) : 0;
  const reviewDaysRemaining = Math.max(0, reviewDays - reviewDaysUsed);

  // For inspection phase, use the clock start as well (simplified — in full impl would track separately)
  const inspectionDaysUsed = phase === "inspection" ? getBusinessDaysElapsed(clockStart) : 0;
  const inspectionDaysRemaining = Math.max(0, inspectionDays - inspectionDaysUsed);

  const isOverdue =
    (phase === "review" && reviewDaysRemaining <= 0) ||
    (phase === "inspection" && inspectionDaysRemaining <= 0);

  return {
    phase,
    reviewDaysUsed,
    reviewDaysTotal: reviewDays,
    reviewDaysRemaining,
    inspectionDaysUsed,
    inspectionDaysTotal: inspectionDays,
    inspectionDaysRemaining,
    isOverdue,
    clockRunning: !isPaused && phase !== "complete" && phase !== "none",
  };
}
