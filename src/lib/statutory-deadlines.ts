/**
 * F.S. 553.791 Statutory Deadline Utilities
 * 
 * Calculates business-day deadlines for Florida Private Provider Act compliance.
 * - 30 business-day plan review window
 * - 10 business-day inspection window
 * Excludes weekends and Florida state holidays per F.S. 553.791(4).
 */

// Florida state holidays (month is 0-indexed)
// Covers fixed holidays; floating holidays computed dynamically
function getFloridaHolidays(year: number): Set<string> {
  const holidays = new Set<string>();

  const addDate = (m: number, d: number) => {
    holidays.add(`${year}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  };

  // Fixed holidays
  addDate(0, 1);   // New Year's Day
  addDate(5, 19);  // Juneteenth (federal + FL observance, since 2021)
  addDate(6, 4);   // Independence Day
  addDate(10, 11);  // Veterans Day
  addDate(11, 24);  // Christmas Eve (FL state holiday per s. 110.117(1)(j))
  addDate(11, 25);  // Christmas Day

  // MLK Day: 3rd Monday in January
  const mlk = getNthWeekday(year, 0, 1, 3); // Jan, Monday, 3rd
  addDate(0, mlk);

  // Presidents' Day: 3rd Monday in February (state observes as well)
  const pres = getNthWeekday(year, 1, 1, 3);
  addDate(1, pres);

  // Memorial Day: Last Monday in May
  const memorial = getLastWeekday(year, 4, 1);
  addDate(4, memorial);

  // Labor Day: 1st Monday in September
  const labor = getNthWeekday(year, 8, 1, 1);
  addDate(8, labor);

  // Thanksgiving: 4th Thursday in November
  const thanksgiving = getNthWeekday(year, 10, 4, 4);
  addDate(10, thanksgiving);
  // Day after Thanksgiving
  addDate(10, thanksgiving + 1);

  return holidays;
}

function getNthWeekday(year: number, month: number, weekday: number, n: number): number {
  let count = 0;
  for (let d = 1; d <= 31; d++) {
    const date = new Date(year, month, d);
    if (date.getMonth() !== month) break;
    if (date.getDay() === weekday) {
      count++;
      if (count === n) return d;
    }
  }
  return 1;
}

function getLastWeekday(year: number, month: number, weekday: number): number {
  let lastDay = 1;
  for (let d = 1; d <= 31; d++) {
    const date = new Date(year, month, d);
    if (date.getMonth() !== month) break;
    if (date.getDay() === weekday) lastDay = d;
  }
  return lastDay;
}

// Cache holidays per year
const holidayCache = new Map<number, Set<string>>();
function getHolidaysForYear(year: number): Set<string> {
  if (!holidayCache.has(year)) {
    holidayCache.set(year, getFloridaHolidays(year));
  }
  return holidayCache.get(year)!;
}

function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function isBusinessDay(date: Date): boolean {
  const day = date.getDay();
  if (day === 0 || day === 6) return false; // Weekend
  const holidays = getHolidaysForYear(date.getFullYear());
  return !holidays.has(formatDateKey(date));
}

export function getBusinessDaysElapsed(startDate: string | null, asOf?: Date): number {
  if (!startDate) return 0;
  const start = new Date(startDate);
  const now = asOf ?? new Date();
  let count = 0;
  const current = new Date(start);
  current.setDate(current.getDate() + 1); // Start counting from next day

  while (current <= now) {
    if (isBusinessDay(current)) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
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

export type StatutoryPhase = "review" | "inspection" | "complete" | "none" | "deemed_approved";

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
  isDeemedApproved: boolean;
}

export function getStatutoryStatus(project: {
  status: string;
  review_clock_started_at?: string | null;
  review_clock_paused_at?: string | null;
  inspection_clock_started_at?: string | null;
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

  // When paused, freeze the count at the moment of pause (F.S. 553.791 compliance).
  // Pass paused_at as asOf so we count days from clockStart up to the pause timestamp,
  // not days since the pause was set.
  const reviewDaysUsed = phase === "review"
    ? (isPaused
        ? getBusinessDaysElapsed(clockStart, new Date(project.review_clock_paused_at!))
        : getBusinessDaysElapsed(clockStart))
    : 0;
  const reviewDaysRemaining = Math.max(0, reviewDays - reviewDaysUsed);

  // Inspection phase uses dedicated inspection clock
  const inspectionClockStart = project.inspection_clock_started_at || clockStart;
  const inspectionDaysUsed = phase === "inspection" ? getBusinessDaysElapsed(inspectionClockStart) : 0;
  const inspectionDaysRemaining = Math.max(0, inspectionDays - inspectionDaysUsed);

  const isOverdue =
    (phase === "review" && reviewDaysRemaining <= 0) ||
    (phase === "inspection" && inspectionDaysRemaining <= 0);

  // Deemed Approved per F.S. 553.791(4)(b): if 30 business days expire without action
  const isDeemedApproved = phase === "review" && reviewDaysRemaining <= 0 && !isPaused;

  if (isDeemedApproved) {
    phase = "deemed_approved";
  }

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
    isDeemedApproved,
  };
}
