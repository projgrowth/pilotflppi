// Barrel export — preserves all existing imports
export type { CountyRequirements, SupplementalSection } from "./county-requirements/types";
export {
  getCountyRequirements,
  getSupplementalSectionLabel,
  getRegisteredCounties,
  getCountiesByRegion,
} from "./county-requirements/utils";
export { DEFAULT_REQUIREMENTS, COUNTY_REGISTRY } from "./county-requirements/data";
