/**
 * Critical Project DNA fields used to gate the dashboard's "DNA blocker"
 * alert. Extracted from the now-deleted DnaHealthBanner so the constant has
 * a stable, dependency-free home.
 */
export const CRITICAL_DNA_FIELDS = [
  "occupancy_classification",
  "construction_type",
  "county",
  "stories",
  "total_sq_ft",
  "fbc_edition",
] as const;
