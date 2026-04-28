/**
 * Computes the "inspection readiness" checklist shown above the
 * "Send Inspection Report to AHJ" action. Mirrors letter-readiness.ts.
 *
 * Required checks:
 *   1. Inspector licensed for trade (F.S. 553.791(2))
 *   2. ≥3 photos with chain-of-custody hashes
 *   3. Threshold special-inspector signature (only for threshold inspections)
 *   4. Narrative present (≥40 chars)
 *   5. No open critical deficiencies if result = pass
 */

export type ReadinessSeverity = "ok" | "warn" | "block";

export interface InspectionReadinessCheck {
  id: "license" | "photos" | "threshold_signoff" | "narrative" | "critical_deficiencies";
  required: boolean;
  severity: ReadinessSeverity;
  title: string;
  detail: string;
}

export interface InspectionReadinessInput {
  trade: string;
  inspectorLicensedTrades: string[];
  photoCount: number;
  isThresholdInspection: boolean;
  thresholdSignerLicense: string | null | undefined;
  narrative: string;
  result: "pass" | "fail" | "partial" | "na";
  openCriticalDeficiencies: number;
}

export interface InspectionReadinessResult {
  checks: InspectionReadinessCheck[];
  allRequiredPassing: boolean;
  blockingCount: number;
}

const MIN_PHOTOS = 3;
const MIN_NARRATIVE = 40;

export function computeInspectionReadiness(input: InspectionReadinessInput): InspectionReadinessResult {
  const checks: InspectionReadinessCheck[] = [];
  const tradeLower = (input.trade ?? "").toLowerCase();
  const licensed = new Set((input.inspectorLicensedTrades ?? []).map((t) => t.toLowerCase()));

  // 1. License coverage
  const licenseOk = licensed.has(tradeLower) || tradeLower === "general";
  checks.push({
    id: "license",
    required: true,
    severity: licenseOk ? "ok" : "block",
    title: licenseOk ? `Inspector licensed for ${tradeLower}` : `Inspector not licensed for ${tradeLower}`,
    detail: licenseOk
      ? "F.S. 553.791(2) discipline-license requirement met."
      : `Add the appropriate Florida professional license to the inspector's profile before submitting this ${tradeLower} report.`,
  });

  // 2. Photos
  const photosOk = input.photoCount >= MIN_PHOTOS;
  checks.push({
    id: "photos",
    required: true,
    severity: photosOk ? "ok" : "block",
    title: photosOk
      ? `${input.photoCount} photos on file`
      : `Only ${input.photoCount}/${MIN_PHOTOS} photos uploaded`,
    detail: photosOk
      ? "Each photo is hashed and timestamped for AHJ chain-of-custody."
      : `At least ${MIN_PHOTOS} hashed photos are required so the AHJ can verify the inspection actually occurred on site.`,
  });

  // 3. Threshold inspector sign-off (only when applicable)
  if (input.isThresholdInspection) {
    const signOk = !!input.thresholdSignerLicense && input.thresholdSignerLicense.trim().length > 0;
    checks.push({
      id: "threshold_signoff",
      required: true,
      severity: signOk ? "ok" : "block",
      title: signOk
        ? "Special Inspector license recorded"
        : "Special Inspector signature missing",
      detail: signOk
        ? "F.S. 553.79(5) threshold inspection sign-off captured."
        : "Threshold-building inspections must be signed by the designated Special Inspector before the report goes to the AHJ.",
    });
  }

  // 4. Narrative
  const narrativeLen = (input.narrative ?? "").trim().length;
  const narrativeOk = narrativeLen >= MIN_NARRATIVE;
  checks.push({
    id: "narrative",
    required: true,
    severity: narrativeOk ? "ok" : "block",
    title: narrativeOk ? "Narrative provided" : "Narrative too short",
    detail: narrativeOk
      ? "Inspector narrative documents what was observed and how compliance was verified."
      : `Write at least ${MIN_NARRATIVE} characters describing what was inspected and how compliance was verified.`,
  });

  // 5. Critical deficiencies (only blocks when result=pass)
  if (input.result === "pass" && input.openCriticalDeficiencies > 0) {
    checks.push({
      id: "critical_deficiencies",
      required: true,
      severity: "block",
      title: `${input.openCriticalDeficiencies} open critical deficiencies`,
      detail: "A 'pass' result cannot be issued while critical deficiencies remain open. Resolve them or downgrade the result to partial/fail.",
    });
  } else {
    checks.push({
      id: "critical_deficiencies",
      required: false,
      severity: "ok",
      title: "No blocking deficiencies for this result",
      detail: input.result === "pass"
        ? "All critical deficiencies are closed."
        : "Result is not 'pass' — open deficiencies do not block submission.",
    });
  }

  const required = checks.filter((c) => c.required);
  const blockingCount = required.filter((c) => c.severity === "block").length;
  return {
    checks,
    allRequiredPassing: blockingCount === 0,
    blockingCount,
  };
}
