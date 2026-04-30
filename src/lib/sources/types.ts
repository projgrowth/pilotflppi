/**
 * Shared types for external data adapters (FEMA, ASCE, future sources).
 *
 * Each adapter writes its `payload` shape into `external_data_snapshots.payload`.
 * Snapshots are cached for 30 days; refresh forces a re-fetch.
 */

export type ExternalSource = "fema_flood" | "asce_hazard";

export interface FemaFloodPayload {
  /** FEMA SFHA flood zone designation, e.g. "X", "AE", "VE". */
  flood_zone: string | null;
  /** Base Flood Elevation in feet (NAVD88), if applicable. */
  bfe_ft: number | null;
  /** FIRM panel number, e.g. "12086C0457L". */
  firm_panel: string | null;
  /** Effective date of the FIRM panel (ISO date). */
  effective_date: string | null;
  /** Whether the queried point falls inside a Special Flood Hazard Area. */
  in_sfha: boolean;
  /** Source query used (lat/lng) for audit. */
  query: { lat: number; lng: number };
}

export interface AsceHazardPayload {
  /** ASCE 7 design wind speed (mph), Risk Category II — most common. */
  wind_speed_mph_riskII: number | null;
  /** ASCE 7 design wind speed (mph), Risk Category III. */
  wind_speed_mph_riskIII: number | null;
  /** ASCE 7 design wind speed (mph), Risk Category IV. */
  wind_speed_mph_riskIV: number | null;
  /** ASCE 7 edition the values were pulled from (e.g. "ASCE 7-22"). */
  edition: string | null;
  /** Default exposure category recommendation from the upstream API. */
  exposure_default: string | null;
  /** Source query used for audit. */
  query: { lat: number; lng: number };
}

export interface ExternalSnapshot<P> {
  id: string;
  plan_review_id: string;
  source: ExternalSource;
  payload: P;
  fetched_at: string;
  expires_at: string | null;
}

export type FemaSnapshot = ExternalSnapshot<FemaFloodPayload>;
export type AsceSnapshot = ExternalSnapshot<AsceHazardPayload>;
