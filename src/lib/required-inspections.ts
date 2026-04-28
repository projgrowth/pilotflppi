/**
 * Derives the list of inspections a project must pass under
 * F.S. 553.79(5) and FBC Chapter 110, given its extracted Project DNA.
 *
 * Pure function — no I/O. Callers persist the result into the
 * `required_inspections` table once per project (idempotent by
 * project_id + inspection_type).
 *
 * Logic mirrors the conservative private-provider standard: when in doubt,
 * include the inspection. False positives cost five minutes; false negatives
 * cost a license.
 */

export interface DerivedRequiredInspection {
  inspection_type: string;
  code_basis: string;
  trade: "building" | "electrical" | "plumbing" | "mechanical" | "structural" | "general";
  is_threshold_inspection: boolean;
  sort_order: number;
}

export interface RequiredInspectionsInput {
  occupancy_classification: string | null | undefined;
  construction_type: string | null | undefined;
  stories: number | null | undefined;
  total_sq_ft: number | null | undefined;
  is_high_rise: boolean | null | undefined;
  isThresholdBuilding: boolean;
  /** From project intake — drives which trade chapters apply. */
  tradeType?: string | null;
}

/**
 * The FBC-110 backbone every vertical building project must pass at minimum.
 * Order matters: it is the actual job-site sequence.
 */
const FBC_110_BACKBONE: DerivedRequiredInspection[] = [
  { inspection_type: "Footing / Foundation", code_basis: "FBC 110.3.1", trade: "structural", is_threshold_inspection: false, sort_order: 10 },
  { inspection_type: "Slab / Under-floor", code_basis: "FBC 110.3.2", trade: "structural", is_threshold_inspection: false, sort_order: 20 },
  { inspection_type: "Framing", code_basis: "FBC 110.3.4", trade: "structural", is_threshold_inspection: false, sort_order: 40 },
  { inspection_type: "Sheathing / Wind-resistance", code_basis: "FBC 110.3.5", trade: "structural", is_threshold_inspection: false, sort_order: 45 },
  { inspection_type: "Insulation / Energy", code_basis: "FBC 110.3.7 + FECC", trade: "building", is_threshold_inspection: false, sort_order: 60 },
  { inspection_type: "Final Building", code_basis: "FBC 110.3.10", trade: "building", is_threshold_inspection: false, sort_order: 100 },
];

/** MEP rough-ins (FBC 110.3.3) — included unless the project DNA explicitly says single-trade. */
const MEP_ROUGH_INS: DerivedRequiredInspection[] = [
  { inspection_type: "Plumbing Rough-in", code_basis: "FBC 110.3.3 / FPC 312", trade: "plumbing", is_threshold_inspection: false, sort_order: 30 },
  { inspection_type: "Electrical Rough-in", code_basis: "FBC 110.3.3 / NEC 110", trade: "electrical", is_threshold_inspection: false, sort_order: 31 },
  { inspection_type: "Mechanical Rough-in", code_basis: "FBC 110.3.3 / FMC 304", trade: "mechanical", is_threshold_inspection: false, sort_order: 32 },
  { inspection_type: "Plumbing Final", code_basis: "FBC 110.3.10 / FPC", trade: "plumbing", is_threshold_inspection: false, sort_order: 90 },
  { inspection_type: "Electrical Final", code_basis: "FBC 110.3.10 / NEC", trade: "electrical", is_threshold_inspection: false, sort_order: 91 },
  { inspection_type: "Mechanical Final", code_basis: "FBC 110.3.10 / FMC", trade: "mechanical", is_threshold_inspection: false, sort_order: 92 },
];

/**
 * F.S. 553.79(5): threshold buildings (>3 stories, >50 ft, or >5,000 sf
 * assembly with >500 occupants) require a Special Inspector to perform
 * structural inspections at specific phases.
 */
const THRESHOLD_SPECIAL_INSPECTOR: DerivedRequiredInspection[] = [
  { inspection_type: "Special Inspector — Soil Compaction / Bearing", code_basis: "F.S. 553.79(5)", trade: "structural", is_threshold_inspection: true, sort_order: 11 },
  { inspection_type: "Special Inspector — Reinforcing Steel & Concrete Placement", code_basis: "F.S. 553.79(5)", trade: "structural", is_threshold_inspection: true, sort_order: 21 },
  { inspection_type: "Special Inspector — Structural Steel & Welding", code_basis: "F.S. 553.79(5)", trade: "structural", is_threshold_inspection: true, sort_order: 41 },
  { inspection_type: "Special Inspector — Lateral Force-Resisting System", code_basis: "F.S. 553.79(5)", trade: "structural", is_threshold_inspection: true, sort_order: 46 },
  { inspection_type: "Special Inspector — Final Structural Sign-off", code_basis: "F.S. 553.79(5)", trade: "structural", is_threshold_inspection: true, sort_order: 99 },
];

/**
 * Single-trade override: when a project's tradeType is plumbing/electrical/
 * mechanical only (not building), we drop the structural backbone and only
 * keep the relevant trade rough-in/final.
 */
const SINGLE_TRADE_KEEP: Record<string, string[]> = {
  plumbing: ["Plumbing Rough-in", "Plumbing Final"],
  electrical: ["Electrical Rough-in", "Electrical Final"],
  mechanical: ["Mechanical Rough-in", "Mechanical Final"],
};

export function deriveRequiredInspections(input: RequiredInspectionsInput): DerivedRequiredInspection[] {
  const trade = (input.tradeType ?? "").toLowerCase();
  const singleTradeFilter = SINGLE_TRADE_KEEP[trade];

  let list: DerivedRequiredInspection[] = [];

  if (singleTradeFilter) {
    // Single-trade permits don't get the full FBC-110 backbone.
    list = MEP_ROUGH_INS.filter((i) => singleTradeFilter.includes(i.inspection_type));
  } else {
    list = [...FBC_110_BACKBONE, ...MEP_ROUGH_INS];
  }

  if (input.isThresholdBuilding) {
    list = list.concat(THRESHOLD_SPECIAL_INSPECTOR);
  }

  return list.sort((a, b) => a.sort_order - b.sort_order);
}
