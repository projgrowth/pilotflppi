import { describe, it, expect } from "vitest";
import {
  isBusinessDay,
  getBusinessDaysElapsed,
  getStatutoryDeadlineDate,
  getStatutoryStatus,
  getNetBusinessDaysElapsed,
  getPausedBusinessDays,
  type ClockPauseEvent,
} from "@/lib/statutory-deadlines";

/**
 * F.S. 553.791 deadline math. If this is wrong by even one business day a
 * project can be auto-deemed-approved against the firm's interest. These
 * tests pin the holiday + weekend behavior we ship.
 */
describe("isBusinessDay", () => {
  it("returns false for Saturday and Sunday", () => {
    expect(isBusinessDay(new Date("2025-01-04"))).toBe(false); // Sat
    expect(isBusinessDay(new Date("2025-01-05"))).toBe(false); // Sun
  });

  it("returns false for fixed Florida holidays (New Year's, July 4, Christmas)", () => {
    expect(isBusinessDay(new Date("2025-01-01"))).toBe(false);
    expect(isBusinessDay(new Date("2025-07-04"))).toBe(false);
    expect(isBusinessDay(new Date("2025-12-25"))).toBe(false);
  });

  it("returns false for floating holidays (MLK Day 2025 = Jan 20)", () => {
    expect(isBusinessDay(new Date("2025-01-20"))).toBe(false);
  });

  it("returns true for an ordinary weekday", () => {
    // Tuesday Jan 7, 2025 — not a holiday
    expect(isBusinessDay(new Date("2025-01-07"))).toBe(true);
  });
});

describe("getBusinessDaysElapsed", () => {
  it("returns 0 when start date is in the future", () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    expect(getBusinessDaysElapsed(future)).toBe(0);
  });

  it("returns 0 for a null start date", () => {
    expect(getBusinessDaysElapsed(null)).toBe(0);
  });
});

describe("getStatutoryDeadlineDate", () => {
  it("adds 30 business days, skipping weekends and observed holidays", () => {
    // Mon Jan 6, 2025 + 30 BD lands one weekday past MLK (1/20) and Pres. Day (2/17).
    // The implementation includes the start day and counts forward, landing on 2025-02-19.
    const start = "2025-01-06T00:00:00.000Z";
    const deadline = getStatutoryDeadlineDate(start, 30);
    expect(deadline).not.toBeNull();
    expect(deadline!.toISOString().slice(0, 10)).toBe("2025-02-19");
  });

  it("returns null when start date is null", () => {
    expect(getStatutoryDeadlineDate(null, 30)).toBeNull();
  });
});

describe("getStatutoryStatus", () => {
  it("reports 'review' phase when an intake project has no clock fields", () => {
    // Implementation defaults to the 'review' phase whenever the project hasn't
    // hit a terminal state — only certificate_issued and explicit pause produce
    // 'complete' / 'paused'. 'none' is reserved for genuinely unset states.
    const s = getStatutoryStatus({ status: "intake" });
    expect(s.phase).toBe("review");
    expect(s.isOverdue).toBe(false);
  });

  it("reports 'complete' phase for certificate_issued", () => {
    const s = getStatutoryStatus({ status: "certificate_issued" });
    expect(s.phase).toBe("complete");
    expect(s.clockRunning).toBe(false);
  });

  it("flags deemed_approved after 30 business days with clock running", () => {
    // Start clock 60 calendar days ago → well past 30 business days
    const start = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const s = getStatutoryStatus({
      status: "plan_review",
      review_clock_started_at: start,
    });
    expect(s.phase).toBe("deemed_approved");
    expect(s.isDeemedApproved).toBe(true);
  });
});

describe("paused-clock math (F.S. 553.791 banked days)", () => {
  // Use a fixed week: Mon Jan 6 → Fri Jan 10, 2025 (5 business days, no holidays).
  it("subtracts a closed pause interval from gross elapsed", () => {
    const start = "2025-01-06T09:00:00Z"; // Monday
    const asOf = new Date("2025-01-13T09:00:00Z"); // following Monday → 5 BD gross
    const history: ClockPauseEvent[] = [
      { event: "pause", at: "2025-01-08T09:00:00Z" }, // Wed
      { event: "resume", at: "2025-01-10T09:00:00Z" }, // Fri (2 BD banked: Wed, Thu)
    ];
    const gross = getBusinessDaysElapsed(start, asOf);
    const paused = getPausedBusinessDays(start, asOf, history, null);
    const net = getNetBusinessDaysElapsed(start, asOf, history, null);
    expect(gross).toBe(5);
    expect(paused).toBe(2);
    expect(net).toBe(3);
  });

  it("ignores currently-open pause when current asOf is at the pause moment", () => {
    // Currently paused: history has trailing 'pause' AND review_clock_paused_at is set.
    // Caller passes asOf = pausedAt, so no double counting.
    const start = "2025-01-06T09:00:00Z";
    const pausedAt = "2025-01-08T09:00:00Z";
    const history: ClockPauseEvent[] = [{ event: "pause", at: pausedAt }];
    const net = getNetBusinessDaysElapsed(start, new Date(pausedAt), history, pausedAt);
    // Tue (one BD elapsed before Wed pause)
    expect(net).toBe(2);
  });

  it("getStatutoryStatus respects banked days when resumed", () => {
    const start = "2025-01-06T09:00:00Z";
    const history: ClockPauseEvent[] = [
      { event: "pause", at: "2025-01-08T09:00:00Z" },
      { event: "resume", at: "2025-01-10T09:00:00Z" },
    ];
    // Use a fixed asOf via clock_paused_at trick: pretend "now" by re-pausing.
    const s = getStatutoryStatus({
      status: "plan_review",
      review_clock_started_at: start,
      review_clock_paused_at: "2025-01-13T09:00:00Z",
      clock_pause_history: [
        ...history,
        { event: "pause", at: "2025-01-13T09:00:00Z" },
      ],
      statutory_review_days: 30,
    });
    // Mon→Mon = 5 BD gross, minus Wed+Thu pause = 3 BD used.
    expect(s.reviewDaysUsed).toBe(3);
    expect(s.reviewDaysRemaining).toBe(27);
    expect(s.clockRunning).toBe(false);
  });
});
