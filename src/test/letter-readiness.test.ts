import { describe, expect, it } from "vitest";
import {
  computeLetterReadiness,
  type ReadinessInput,
} from "@/lib/letter-readiness";

type Finding = ReadinessInput["findings"][number];

function f(overrides: Partial<Finding> = {}): Finding {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    reviewer_disposition: "confirm",
    status: "open",
    verification_status: "verified",
    citation_status: "verified",
    confidence_score: 0.9,
    evidence_crop_meta: null,
    ...overrides,
  } as Finding;
}

function baseInput(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    findings: [f()],
    qcStatus: "qc_approved",
    reviewerIsSoleSigner: true,
    projectDnaMissingFields: [],
    noticeToBuildingOfficialFiledAt: "2026-01-01T00:00:00Z",
    complianceAffidavitSignedAt: "2026-01-02T00:00:00Z",
    disciplinesInLetter: ["structural"],
    reviewerLicensedDisciplines: ["structural"],
    isThresholdBuilding: false,
    thresholdTriggers: [],
    specialInspectorDesignated: false,
    coveragePct: 100,
    blockLetterOnLowCoverage: true,
    blockLetterOnUngrounded: true,
    ...overrides,
  };
}

const findCheck = (
  res: ReturnType<typeof computeLetterReadiness>,
  id: ReadinessInput["findings"] extends infer _ ? string : never,
) => res.checks.find((c) => c.id === (id as never));

describe("computeLetterReadiness", () => {
  it("returns unique check ids (no duplicate citations id — audit C-05)", () => {
    const res = computeLetterReadiness(baseInput());
    const ids = res.checks.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("happy path passes every required check", () => {
    const res = computeLetterReadiness(baseInput());
    expect(res.allRequiredPassing).toBe(true);
    expect(res.blockingCount).toBe(0);
  });

  it("triage: blocks when any live finding lacks a disposition", () => {
    const res = computeLetterReadiness(
      baseInput({ findings: [f({ reviewer_disposition: null })] }),
    );
    const c = findCheck(res, "triage");
    expect(c?.severity).toBe("block");
    expect(res.allRequiredPassing).toBe(false);
  });

  it("triage: ignores resolved/waived findings", () => {
    const res = computeLetterReadiness(
      baseInput({
        findings: [
          f({ status: "resolved", reviewer_disposition: null }),
          f({ status: "waived", reviewer_disposition: null }),
        ],
      }),
    );
    expect(findCheck(res, "triage")?.severity).toBe("ok");
  });

  it("citations: blocks on hallucinated citation regardless of disposition", () => {
    const res = computeLetterReadiness(
      baseInput({ findings: [f({ citation_status: "hallucinated" })] }),
    );
    expect(findCheck(res, "citations")?.severity).toBe("block");
  });

  it("citations: blocks undecided mismatch / not_found", () => {
    const res = computeLetterReadiness(
      baseInput({
        findings: [
          f({ citation_status: "mismatch", reviewer_disposition: null }),
          f({ citation_status: "not_found", reviewer_disposition: null }),
        ],
      }),
    );
    expect(findCheck(res, "citations")?.severity).toBe("block");
  });

  it("citations: a reviewer disposition releases mismatch/not_found", () => {
    const res = computeLetterReadiness(
      baseInput({
        findings: [
          f({ citation_status: "mismatch", reviewer_disposition: "modify" }),
        ],
      }),
    );
    expect(findCheck(res, "citations")?.severity).toBe("ok");
  });

  it("citations: verified_stub blocks when firm setting is on", () => {
    const res = computeLetterReadiness(
      baseInput({
        findings: [
          f({ citation_status: "verified_stub", reviewer_disposition: null }),
        ],
        blockLetterOnUngrounded: true,
      }),
    );
    expect(findCheck(res, "citations")?.severity).toBe("block");
  });

  it("citations: verified_stub passes when firm opts out", () => {
    const res = computeLetterReadiness(
      baseInput({
        findings: [
          f({ citation_status: "verified_stub", reviewer_disposition: null }),
        ],
        blockLetterOnUngrounded: false,
      }),
    );
    expect(findCheck(res, "citations")?.severity).toBe("ok");
  });

  it("citations: low-confidence + unverified blocks; high-confidence does not", () => {
    const blocked = computeLetterReadiness(
      baseInput({
        findings: [
          f({
            citation_status: "unverified",
            confidence_score: 0.4,
            reviewer_disposition: null,
          }),
        ],
      }),
    );
    expect(findCheck(blocked, "citations")?.severity).toBe("block");

    const ok = computeLetterReadiness(
      baseInput({
        findings: [
          f({ citation_status: "unverified", confidence_score: 0.9 }),
        ],
      }),
    );
    expect(findCheck(ok, "citations")?.severity).toBe("ok");
  });

  it("verifier_completion: blocks when >25% of findings never reached the verifier", () => {
    const findings = [
      f({ verification_status: "unverified" }),
      f({ verification_status: "unverified" }),
      f({ verification_status: "verified" }),
    ];
    const res = computeLetterReadiness(baseInput({ findings }));
    expect(findCheck(res, "verifier_completion")?.severity).toBe("block");
  });

  it("sheet_refs: blocks when evidence_crop_meta.unresolved_sheet is true", () => {
    const res = computeLetterReadiness(
      baseInput({
        findings: [f({ evidence_crop_meta: { unresolved_sheet: true } })],
      }),
    );
    expect(findCheck(res, "sheet_refs")?.severity).toBe("block");
  });

  it("qc: warn (not block) when reviewer is sole signer and qc not approved", () => {
    const res = computeLetterReadiness(
      baseInput({ qcStatus: "pending_qc", reviewerIsSoleSigner: true }),
    );
    const qc = findCheck(res, "qc");
    expect(qc?.severity).toBe("warn");
    expect(qc?.required).toBe(false);
    expect(res.allRequiredPassing).toBe(true);
  });

  it("qc: blocks when multi-reviewer firm and qc not approved", () => {
    const res = computeLetterReadiness(
      baseInput({ qcStatus: "pending_qc", reviewerIsSoleSigner: false }),
    );
    const qc = findCheck(res, "qc");
    expect(qc?.severity).toBe("block");
    expect(qc?.required).toBe(true);
  });

  it("notice_filed: blocks when missing", () => {
    const res = computeLetterReadiness(
      baseInput({ noticeToBuildingOfficialFiledAt: null }),
    );
    expect(findCheck(res, "notice_filed")?.severity).toBe("block");
  });

  it("affidavit_signed: blocks when missing", () => {
    const res = computeLetterReadiness(
      baseInput({ complianceAffidavitSignedAt: null }),
    );
    expect(findCheck(res, "affidavit_signed")?.severity).toBe("block");
  });

  it("reviewer_licensed: blocks when a discipline in the letter has no license", () => {
    const res = computeLetterReadiness(
      baseInput({
        disciplinesInLetter: ["structural", "mechanical"],
        reviewerLicensedDisciplines: ["structural"],
      }),
    );
    expect(findCheck(res, "reviewer_licensed")?.severity).toBe("block");
  });

  it("reviewer_licensed: ignores cross_sheet/administrative/general disciplines", () => {
    const res = computeLetterReadiness(
      baseInput({
        disciplinesInLetter: ["cross_sheet", "administrative", "general"],
        reviewerLicensedDisciplines: [],
      }),
    );
    expect(findCheck(res, "reviewer_licensed")?.severity).toBe("ok");
  });

  it("threshold_special_inspector: only present when isThresholdBuilding", () => {
    const off = computeLetterReadiness(baseInput({ isThresholdBuilding: false }));
    expect(findCheck(off, "threshold_special_inspector")).toBeUndefined();

    const blocked = computeLetterReadiness(
      baseInput({
        isThresholdBuilding: true,
        thresholdTriggers: [">3 stories"],
        specialInspectorDesignated: false,
      }),
    );
    expect(findCheck(blocked, "threshold_special_inspector")?.severity).toBe("block");

    const ok = computeLetterReadiness(
      baseInput({
        isThresholdBuilding: true,
        thresholdTriggers: [">3 stories"],
        specialInspectorDesignated: true,
      }),
    );
    expect(findCheck(ok, "threshold_special_inspector")?.severity).toBe("ok");
  });

  it("coverage: blocks when coverage < 100 and gate is on", () => {
    const res = computeLetterReadiness(
      baseInput({ coveragePct: 78, blockLetterOnLowCoverage: true }),
    );
    expect(findCheck(res, "coverage")?.severity).toBe("block");
  });

  it("coverage: omitted when firm opts out", () => {
    const res = computeLetterReadiness(
      baseInput({ coveragePct: 50, blockLetterOnLowCoverage: false }),
    );
    expect(findCheck(res, "coverage")).toBeUndefined();
  });

  it("project_dna: advisory only — never blocks", () => {
    const res = computeLetterReadiness(
      baseInput({ projectDnaMissingFields: ["occupancy", "construction_type"] }),
    );
    const dna = findCheck(res, "project_dna");
    expect(dna?.severity).toBe("warn");
    expect(dna?.required).toBe(false);
    expect(res.allRequiredPassing).toBe(true);
  });

  it("blockingCount equals number of failing required checks", () => {
    const res = computeLetterReadiness(
      baseInput({
        findings: [f({ reviewer_disposition: null })],
        noticeToBuildingOfficialFiledAt: null,
        complianceAffidavitSignedAt: null,
      }),
    );
    expect(res.blockingCount).toBe(3);
    expect(res.allRequiredPassing).toBe(false);
  });
});
