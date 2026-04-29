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
  if (now <= start) return 0;
  let count = 0;
  const current = new Date(start);
  current.setDate(current.getDate() + 1); // Start counting from next day

  while (current <= now) {
    if (isBusinessDay(current)) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

/**
 * A single entry in projects.clock_pause_history.
 * Written by the log_clock_state_changes() trigger.
 */
export interface ClockPauseEvent {
  event: "pause" | "resume";
  at: string; // ISO timestamp
  reason?: string | null;
  status?: string | null;
}

/**
 * Convert pause/resume event log into closed [pausedAt, resumedAt] intervals.
 * If currentPausedAt is set and the last event was a pause without a matching
 * resume, the open interval is included with end = currentPausedAt (i.e. it
 * stays paused indefinitely; today's elapsed should still freeze at pause).
 */
function buildPausedIntervals(
  history: ClockPauseEvent[] | null | undefined,
  currentPausedAt: string | null | undefined,
): Array<{ start: Date; end: Date }> {
  const events = (history ?? [])
    .filter((e) => e && (e.event === "pause" || e.event === "resume") && e.at)
    .slice()
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const intervals: Array<{ start: Date; end: Date }> = [];
  let openStart: Date | null = null;

  for (const ev of events) {
    if (ev.event === "pause") {
      if (!openStart) openStart = new Date(ev.at);
    } else if (ev.event === "resume") {
      if (openStart) {
        intervals.push({ start: openStart, end: new Date(ev.at) });
        openStart = null;
      }
    }
  }
  // Dangling pause without resume — currently still paused.
  if (openStart && currentPausedAt) {
    // already represented by freezing asOf at currentPausedAt; skip to avoid double counting
  } else if (openStart) {
    // unusual: history says paused but column is null — treat as ongoing to "now"
    intervals.push({ start: openStart, end: new Date() });
  }
  return intervals;
}

/**
 * Sum business days that fell inside paused intervals between start and asOf.
 * Used to subtract banked days from gross elapsed.
 */
export function getPausedBusinessDays(
  startDate: string | null,
  asOf: Date,
  history: ClockPauseEvent[] | null | undefined,
  currentPausedAt: string | null | undefined,
): number {
  if (!startDate) return 0;
  const start = new Date(startDate);
  const intervals = buildPausedIntervals(history, currentPausedAt);
  let total = 0;
  for (const { start: pStart, end: pEnd } of intervals) {
    const lo = pStart < start ? start : pStart;
    const hi = pEnd > asOf ? asOf : pEnd;
    if (hi <= lo) continue;
    total += getBusinessDaysElapsed(lo.toISOString(), hi);
  }
  return total;
}

/**
 * Net business days the clock has actually been running between start and asOf,
 * subtracting any banked paused intervals.
 */
export function getNetBusinessDaysElapsed(
  startDate: string | null,
  asOf: Date | undefined,
  history: ClockPauseEvent[] | null | undefined,
  currentPausedAt: string | null | undefined,
): number {
  if (!startDate) return 0;
  const now = asOf ?? new Date();
  const gross = getBusinessDaysElapsed(startDate, now);
  const paused = getPausedBusinessDays(startDate, now, history, currentPausedAt);
  return Math.max(0, gross - paused);
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
  clock_pause_history?: ClockPauseEvent[] | null;
}): StatutoryStatus {
  const reviewDays = project.statutory_review_days ?? 30;
  const inspectionDays = project.statutory_inspection_days ?? 10;
  const clockStart = project.review_clock_started_at || project.notice_filed_at;
  const isPaused = !!project.review_clock_paused_at;
  const history = project.clock_pause_history ?? null;

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

  // Net elapsed = gross business days from clockStart up to "now" (or to the
  // current pause moment if currently paused), MINUS business days banked
  // during prior pause/resume cycles. Required for F.S. 553.791 because the
  // clock can pause when comments are sent and resume when resubmitted.
  const asOf = isPaused ? new Date(project.review_clock_paused_at!) : new Date();
  const reviewDaysUsed =
    phase === "review"
      ? getNetBusinessDaysElapsed(clockStart, asOf, history, project.review_clock_paused_at)
      : 0;
  const reviewDaysRemaining = Math.max(0, reviewDays - reviewDaysUsed);

  // Inspection phase uses dedicated inspection clock (no pause semantics yet).
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
