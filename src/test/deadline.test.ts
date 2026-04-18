import { describe, it, expect } from "vitest";
import {
  isBusinessDay,
  getBusinessDaysElapsed,
  getStatutoryDeadlineDate,
  getStatutoryStatus,
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
  it("adds 30 business days skipping weekends and holidays", () => {
    // Start Mon Jan 6, 2025 → +30 business days, skipping MLK (Jan 20) +
    // Presidents' Day (Feb 17). Should land on Tue Feb 18, 2025.
    const start = "2025-01-06T00:00:00.000Z";
    const deadline = getStatutoryDeadlineDate(start, 30);
    expect(deadline).not.toBeNull();
    // Compare yyyy-mm-dd to avoid timezone drift in CI
    expect(deadline!.toISOString().slice(0, 10)).toBe("2025-02-18");
  });

  it("returns null when start date is null", () => {
    expect(getStatutoryDeadlineDate(null, 30)).toBeNull();
  });
});

describe("getStatutoryStatus", () => {
  it("reports 'none' phase when project has no clock", () => {
    const s = getStatutoryStatus({ status: "intake" });
    expect(s.phase).toBe("none");
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
