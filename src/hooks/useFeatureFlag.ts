/**
 * Per-firm feature flag reader.
 *
 * Flags live in `firm_settings.feature_flags` (jsonb) so admins can toggle
 * beta capabilities at runtime without a deploy. Returns `false` while the
 * settings query is loading so flagged surfaces never flash in.
 */
import { useFirmSettings } from "./useFirmSettings";

export type FeatureFlag = "external_data_v1";

export function useFeatureFlag(flag: FeatureFlag): boolean {
  const { firmSettings } = useFirmSettings();
  const flags = firmSettings?.feature_flags;
  if (!flags || typeof flags !== "object") return false;
  return flags[flag] === true;
}
