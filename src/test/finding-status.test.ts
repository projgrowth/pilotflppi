import { describe, it, expect } from "vitest";
import type { FindingStatus } from "@/components/FindingStatusFilter";

/**
 * Reducer pulled out of PlanReviewDetail.updateFindingStatus so it's testable
 * without React. Mirrors the production behavior: setting a status is
 * idempotent, and "open" is the default for an unknown index.
 */
function applyStatus(
  prev: Record<string, FindingStatus>,
  key: string,
  status: FindingStatus
): { next: Record<string, FindingStatus>; oldStatus: FindingStatus } {
  const oldStatus = prev[key] || "open";
  const next = { ...prev, [key]: status };
  return { next, oldStatus };
}

describe("finding status reducer", () => {
  it("treats unknown keys as 'open'", () => {
    const { oldStatus } = applyStatus({}, "abc", "resolved");
    expect(oldStatus).toBe("open");
  });

  it("resolves a previously open finding", () => {
    const { next, oldStatus } = applyStatus({ abc: "open" }, "abc", "resolved");
    expect(oldStatus).toBe("open");
    expect(next.abc).toBe("resolved");
  });

  it("re-opens a resolved finding", () => {
    const { next, oldStatus } = applyStatus({ abc: "resolved" }, "abc", "open");
    expect(oldStatus).toBe("resolved");
    expect(next.abc).toBe("open");
  });

  it("does not touch other keys", () => {
    const prev: Record<string, FindingStatus> = { a: "open", b: "deferred" };
    const { next } = applyStatus(prev, "a", "resolved");
    expect(next.b).toBe("deferred");
    expect(next.a).toBe("resolved");
  });

  it("is idempotent when setting the same status twice", () => {
    const prev: Record<string, FindingStatus> = { a: "resolved" };
    const r1 = applyStatus(prev, "a", "resolved");
    const r2 = applyStatus(r1.next, "a", "resolved");
    expect(r2.next).toEqual(r1.next);
  });
});
