// Barrel export — preserves all existing imports
export type { CountyRequirements, SupplementalSection } from "./county-requirements/types";
export {
  getCountyRequirements,
  getSupplementalSectionLabel,
} from "./county-requirements/utils";
export { COUNTY_REGISTRY } from "./county-requirements/data";
