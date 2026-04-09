/**
 * County-specific requirements types for Florida building departments.
 */

export interface CountyRequirements {
  key: string;
  label: string;
  hvhz: boolean;
  /** Coastal Construction Control Line applies */
  cccl: boolean;
  /** Product approval format used */
  productApprovalFormat: "NOA" | "FL#" | "both";
  /** Days allowed for resubmission (default 14) */
  resubmissionDays: number;
  /** County-specific code amendment references */
  amendments: { ref: string; description: string }[];
  /** Supplemental sections required in comment letters */
  supplementalSections: SupplementalSection[];
  /** Building department info for addressee */
  buildingDepartment: {
    name: string;
    officialTitle: string;
    address: string;
  };
  /** Wind speed design requirement (mph) */
  designWindSpeed: string;
  /** Additional submission notes */
  submissionNotes: string[];
  /** Threshold building dollar amount */
  thresholdBuildingAmount: number;
  /** Energy code compliance path preference */
  energyCodePath: "prescriptive" | "performance" | "either";
  /** Wind-borne debris region */
  windBorneDebrisRegion: boolean;
  /** Flood zone determination required */
  floodZoneRequired: boolean;
}

export type SupplementalSection =
  | "wind_mitigation"
  | "wind_mitigation_enhanced"
  | "flood_zone"
  | "threshold_building"
  | "product_approval_table"
  | "noa_table"
  | "cccl_compliance"
  | "energy_compliance";
