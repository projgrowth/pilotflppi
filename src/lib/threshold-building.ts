/**
 * Florida threshold-building detection (F.S. 553.79(5)).
 *
 * A "threshold building" under Florida law is one that:
 *   (a) is greater than 3 stories or 50 feet in height; OR
 *   (b) has an assembly occupancy classified per FBC-B Ch. 3 that exceeds
 *       5,000 square feet in area and is designed to occupy more than 500
 *       persons.
 *
 * Detected solely from project_dna fields the AI already extracts:
 *   stories, total_sq_ft, occupancy_classification, (optional) is_high_rise,
 *   (optional) occupant_load.
 *
 * When this returns `isThresholdBuilding: true`, the EOR must designate a
 * licensed Special Inspector and the Statement of Special Inspections must
 * be on the structural drawings (FBC-B 1704.6 / 1705).
 */
export interface ThresholdInput {
  stories: number | null | undefined;
  total_sq_ft: number | null | undefined;
  occupancy_classification: string | null | undefined;
  is_high_rise?: boolean | null | undefined;
  /** Optional explicit occupant load if the DNA extractor captured it. */
  occupant_load?: number | null | undefined;
}

export interface ThresholdResult {
  isThresholdBuilding: boolean;
  triggers: string[];
}

const ASSEMBLY_OCC_RE = /\bA[-\s]?[1-5]\b/i;

export function detectThresholdBuilding(dna: ThresholdInput | null | undefined): ThresholdResult {
  if (!dna) return { isThresholdBuilding: false, triggers: [] };
  const triggers: string[] = [];

  const stories = typeof dna.stories === "number" ? dna.stories : null;
  if (stories !== null && stories > 3) {
    triggers.push(`${stories} stories (>3)`);
  }

  // High-rise per FBC = >75 ft above lowest level of fire dept access; we use
  // is_high_rise as a proxy if the DNA extractor flagged it.
  if (dna.is_high_rise === true) {
    triggers.push("High-rise (>75 ft per FBC)");
  }

  const occ = (dna.occupancy_classification ?? "").toString();
  const isAssembly = ASSEMBLY_OCC_RE.test(occ);
  const sqft = typeof dna.total_sq_ft === "number" ? dna.total_sq_ft : null;
  const occupantLoad =
    typeof dna.occupant_load === "number" ? dna.occupant_load : null;

  if (isAssembly && sqft !== null && sqft > 5000) {
    if (occupantLoad === null) {
      // Assembly + >5,000 sf nearly always exceeds 500 occupants at FBC-B
      // 1004 default densities (assembly unconcentrated = 15 sf/occ).
      // Flag advisorially via the trigger label so the reviewer can confirm.
      triggers.push(
        `Assembly occupancy (${occ}) at ${sqft.toLocaleString()} sf — verify >500 occupants`,
      );
    } else if (occupantLoad > 500) {
      triggers.push(
        `Assembly occupancy (${occ}), ${sqft.toLocaleString()} sf, OL ${occupantLoad} (>500)`,
      );
    }
    // else: occupantLoad ≤ 500 — definitively NOT a threshold building under
    // F.S. 553.79(5)(b). Skip the trigger entirely. (Audit M-01 fix: prevents
    // false-positive Special Inspector requirements when DNA captures OL.)
  }

  return {
    isThresholdBuilding: triggers.length > 0,
    triggers,
  };
}
