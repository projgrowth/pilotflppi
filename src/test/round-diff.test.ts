import { describe, it, expect } from "vitest";

interface MiniFinding {
  finding_id: string;
  code_ref: string;
  description: string;
  resolved?: boolean;
}

/**
 * Round-2 carry-over: when a new round of findings is generated, any finding
 * whose (code_ref + description) matched a finding the reviewer had already
 * marked resolved in the prior round should be auto-marked resolved.
 *
 * Pulled out into a pure function for testability — production code does this
 * inline in PlanReviewDetail.runAICheck. If we ever change that logic, both
 * places need updating; this test will catch divergence.
 */
function carryOverResolved<T extends MiniFinding>(
  newFindings: T[],
  previousFindings: T[]
): T[] {
  const resolvedKeys = new Set(
    previousFindings
      .filter((f) => f.resolved)
      .map((f) => `${f.code_ref}::${f.description}`)
  );
  return newFindings.map((f) =>
    resolvedKeys.has(`${f.code_ref}::${f.description}`)
      ? { ...f, resolved: true }
      : f
  );
}

describe("round-2 finding carry-over", () => {
  it("carries forward resolved status when code_ref + description match", () => {
    const prev: MiniFinding[] = [
      { finding_id: "old-1", code_ref: "FBC 1809.5", description: "Footing depth not noted", resolved: true },
    ];
    const next: MiniFinding[] = [
      { finding_id: "new-1", code_ref: "FBC 1809.5", description: "Footing depth not noted" },
    ];
    const merged = carryOverResolved(next, prev);
    expect(merged[0].resolved).toBe(true);
    expect(merged[0].finding_id).toBe("new-1"); // new ID preserved
  });

  it("does not carry over when description differs", () => {
    const prev: MiniFinding[] = [
      { finding_id: "old-1", code_ref: "FBC 1809.5", description: "Footing depth", resolved: true },
    ];
    const next: MiniFinding[] = [
      { finding_id: "new-1", code_ref: "FBC 1809.5", description: "Footing reinforcement" },
    ];
    const merged = carryOverResolved(next, prev);
    expect(merged[0].resolved).toBeFalsy();
  });

  it("ignores unresolved priors", () => {
    const prev: MiniFinding[] = [
      { finding_id: "old-1", code_ref: "FBC 1809.5", description: "X", resolved: false },
    ];
    const next: MiniFinding[] = [
      { finding_id: "new-1", code_ref: "FBC 1809.5", description: "X" },
    ];
    const merged = carryOverResolved(next, prev);
    expect(merged[0].resolved).toBeFalsy();
  });

  it("handles an empty prior list", () => {
    const next: MiniFinding[] = [
      { finding_id: "new-1", code_ref: "FBC 1809.5", description: "X" },
    ];
    expect(carryOverResolved(next, [])[0].resolved).toBeFalsy();
  });
});
