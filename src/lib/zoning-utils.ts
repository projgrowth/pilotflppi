// Zoning & Lot Allowance calculation utilities

export interface ZoningData {
  zoning_district: string;
  lot_area_sqft: number | null;
  building_footprint_sqft: number | null;
  total_building_area_sqft: number | null;
  stories: number | null;
  max_far: number | null;
  max_lot_coverage_pct: number | null;
  max_height_ft: number | null;
  max_stories: number | null;
  setback_front_ft: number | null;
  setback_side_ft: number | null;
  setback_rear_ft: number | null;
  parking_ratio_per_sqft: number | null;
  landscape_buffer_ft: number | null;
  frontage_lf: number | null;
  signage_ratio_sqft_per_lf: number | null;
  occupancy_groups: string[];
  notes: string;
}

export const EMPTY_ZONING: ZoningData = {
  zoning_district: "",
  lot_area_sqft: null,
  building_footprint_sqft: null,
  total_building_area_sqft: null,
  stories: null,
  max_far: null,
  max_lot_coverage_pct: null,
  max_height_ft: null,
  max_stories: null,
  setback_front_ft: null,
  setback_side_ft: null,
  setback_rear_ft: null,
  parking_ratio_per_sqft: null,
  landscape_buffer_ft: null,
  frontage_lf: null,
  signage_ratio_sqft_per_lf: null,
  occupancy_groups: [],
  notes: "",
};

export interface ZoningCheck {
  label: string;
  status: "pass" | "fail" | "info";
  actual: string;
  allowed: string;
  detail?: string;
}

export function computeFAR(totalBuildingArea: number | null, lotArea: number | null): number | null {
  if (!totalBuildingArea || !lotArea || lotArea === 0) return null;
  return totalBuildingArea / lotArea;
}

export function computeLotCoverage(footprint: number | null, lotArea: number | null): number | null {
  if (!footprint || !lotArea || lotArea === 0) return null;
  return (footprint / lotArea) * 100;
}

export function computeParkingRequired(totalArea: number | null, ratioPer: number | null): number | null {
  if (!totalArea || !ratioPer || ratioPer === 0) return null;
  return Math.ceil(totalArea / ratioPer);
}

export function computeSignageAllowance(frontage: number | null, ratio: number | null): number | null {
  if (!frontage || !ratio) return null;
  return frontage * ratio;
}

export function runZoningChecks(z: ZoningData): ZoningCheck[] {
  const checks: ZoningCheck[] = [];

  // FAR check
  const actualFar = computeFAR(z.total_building_area_sqft, z.lot_area_sqft);
  if (actualFar !== null && z.max_far !== null) {
    checks.push({
      label: "Floor Area Ratio (FAR)",
      status: actualFar <= z.max_far ? "pass" : "fail",
      actual: actualFar.toFixed(2),
      allowed: `≤ ${z.max_far}`,
      detail: actualFar > z.max_far
        ? `Building area exceeds FAR by ${((actualFar - z.max_far) * (z.lot_area_sqft || 0)).toLocaleString()} sqft — variance required`
        : undefined,
    });
  }

  // Lot coverage
  const actualCoverage = computeLotCoverage(z.building_footprint_sqft, z.lot_area_sqft);
  if (actualCoverage !== null && z.max_lot_coverage_pct !== null) {
    checks.push({
      label: "Lot Coverage",
      status: actualCoverage <= z.max_lot_coverage_pct ? "pass" : "fail",
      actual: `${actualCoverage.toFixed(1)}%`,
      allowed: `≤ ${z.max_lot_coverage_pct}%`,
    });
  }

  // Height
  if (z.stories !== null && z.max_stories !== null) {
    checks.push({
      label: "Stories",
      status: z.stories <= z.max_stories ? "pass" : "fail",
      actual: `${z.stories}`,
      allowed: `≤ ${z.max_stories}`,
    });
  }

  // Parking
  const parkingReq = computeParkingRequired(z.total_building_area_sqft, z.parking_ratio_per_sqft);
  if (parkingReq !== null) {
    checks.push({
      label: "Parking Spaces Required",
      status: "info",
      actual: `${parkingReq} spaces`,
      allowed: `1 per ${z.parking_ratio_per_sqft} sqft`,
    });
  }

  // Signage
  const signage = computeSignageAllowance(z.frontage_lf, z.signage_ratio_sqft_per_lf);
  if (signage !== null) {
    checks.push({
      label: "Signage Allowance",
      status: "info",
      actual: `${signage.toFixed(0)} sqft`,
      allowed: `${z.signage_ratio_sqft_per_lf} sqft/LF × ${z.frontage_lf} LF`,
    });
  }

  // Occupancy groups
  if (z.occupancy_groups.length > 0) {
    checks.push({
      label: "Occupancy Groups",
      status: "info",
      actual: z.occupancy_groups.join(", "),
      allowed: "Per FBC Chapter 3",
      detail: z.occupancy_groups.length > 1
        ? "Mixed occupancy — fire separation per FBC Table 508.4 required"
        : undefined,
    });
  }

  return checks;
}

export const COMMON_OCCUPANCY_GROUPS = [
  { code: "A-2", label: "A-2 — Assembly (restaurants, bars)" },
  { code: "B", label: "B — Business (offices, banks)" },
  { code: "E", label: "E — Educational" },
  { code: "F-1", label: "F-1 — Factory (moderate hazard)" },
  { code: "H-3", label: "H-3 — High Hazard (flammable liquids)" },
  { code: "I-1", label: "I-1 — Institutional (assisted living)" },
  { code: "M", label: "M — Mercantile (retail, showroom)" },
  { code: "R-1", label: "R-1 — Residential (hotels)" },
  { code: "R-2", label: "R-2 — Residential (apartments)" },
  { code: "S-1", label: "S-1 — Storage (moderate hazard)" },
  { code: "S-2", label: "S-2 — Storage (low hazard, parking)" },
  { code: "U", label: "U — Utility (accessory)" },
];
