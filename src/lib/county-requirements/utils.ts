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

/** List all registered county keys */
export function getRegisteredCounties(): string[] {
  return Object.keys(COUNTY_REGISTRY);
}

/** Get all counties grouped by region */
export function getCountiesByRegion(): Record<string, string[]> {
  const regions: Record<string, string[]> = {
    "Southeast": ["miami-dade", "broward", "palm-beach", "martin", "st-lucie", "indian-river", "okeechobee"],
    "Southwest": ["lee", "collier", "charlotte", "sarasota", "manatee", "hendry", "glades", "desoto"],
    "Tampa Bay": ["hillsborough", "pinellas", "pasco", "polk", "hernando"],
    "Central": ["orange", "osceola", "seminole", "lake", "sumter", "brevard", "volusia"],
    "Northeast": ["duval", "st-johns", "clay", "nassau", "baker", "flagler", "putnam"],
    "Northwest / Panhandle": [
      "escambia", "santa-rosa", "okaloosa", "walton", "holmes", "washington",
      "bay", "jackson", "calhoun", "gulf", "liberty", "gadsden", "leon",
      "wakulla", "franklin", "jefferson", "madison", "taylor", "hamilton",
      "suwannee", "lafayette", "dixie"
    ],
    "North Central": ["alachua", "columbia", "bradford", "union", "gilchrist", "levy", "marion", "citrus"],
    "Treasure Coast / Keys": ["monroe", "hardee", "highlands"],
  };
  return regions;
}
