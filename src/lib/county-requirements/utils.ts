import type { CountyRequirements, SupplementalSection } from "./types";
import { COUNTY_REGISTRY, DEFAULT_REQUIREMENTS } from "./data";

/**
 * Get the full county requirements config for a given county key.
 * Falls back to sensible defaults for unknown counties.
 */
export function getCountyRequirements(county: string): CountyRequirements {
  const key = county.toLowerCase().trim().replace(/\s+/g, "-");
  const override = COUNTY_REGISTRY[key];
  if (!override) return { ...DEFAULT_REQUIREMENTS, key, label: county };
  return { ...DEFAULT_REQUIREMENTS, ...override } as CountyRequirements;
}

/** Get a human-readable label for a supplemental section */
export function getSupplementalSectionLabel(section: SupplementalSection): string {
  const labels: Record<SupplementalSection, string> = {
    wind_mitigation: "Wind Mitigation Summary",
    wind_mitigation_enhanced: "Enhanced Wind Mitigation (HVHZ)",
    flood_zone: "Flood Zone Compliance Statement",
    threshold_building: "Threshold Building Disclosure",
    product_approval_table: "Product Approval Checklist (FL#)",
    noa_table: "Notice of Acceptance (NOA) Table",
    cccl_compliance: "Coastal Construction Control Line Compliance",
    energy_compliance: "Energy Code Compliance Path",
  };
  return labels[section] || section;
}

