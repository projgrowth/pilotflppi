/**
 * Shared domain types used across multiple components/pages.
 * Component-local prop interfaces stay where they're used; only
 * shapes referenced by 2+ files belong here.
 */

export interface ContractorInfo {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  license_number: string | null;
}

export interface ProjectInfo {
  id: string;
  name: string;
  address: string;
  trade_type: string;
  county: string;
  jurisdiction: string;
  contractor: ContractorInfo | null;
}

export interface MarkupData {
  page_index: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  annotations?: { x: number; y: number; width: number; height: number; label?: string }[];
  /** Grid cell anchor returned by the AI (e.g. "H7"). Row letter A-J + column digit 0-9. */
  grid_cell?: string;
  /** A short string the model claims it could literally read on the sheet near the pin. */
  nearest_text?: string;
  /** Confidence in pin location: high = anchor verified or human-placed; medium = grid_cell only; low = no anchor. */
  pin_confidence?: "high" | "medium" | "low";
  /** True once a human has manually repositioned this pin — never downgrade after that. */
  user_repositioned?: boolean;
}

export interface Finding {
  /** Stable per-finding UUID assigned at parse time. Status, history, crops,
   *  and corrections lookups all key off this — never the array index. Old
   *  data without an id is auto-healed on next read (see PlanReviewDetail). */
  finding_id?: string;
  severity: string;
  discipline?: string;
  code_ref: string;
  county_specific?: boolean;
  page: string;
  description: string;
  recommendation: string;
  confidence?: string;
  markup?: MarkupData;
  resolved?: boolean;
  /** Short audit trail: WHY the AI flagged this. 1–2 sentences citing the specific
   *  visual element (dimension, callout, missing note) it observed. Persisted so
   *  building officials can challenge a finding and we can defend it. */
  reasoning?: string;
  /** Stamp of which prompt + model produced this finding (for post-hoc audits). */
  prompt_version?: string;
  model_version?: string;
  /** Storage path of the JPEG crop the AI analyzed during second-pass refinement.
   *  Surfaced inline under the "Why?" disclosure so building officials can see
   *  exactly the image evidence the model worked from. */
  crop_url?: string;
  /** Optional pinned visual evidence crop (PNG URL in Storage). Embedded in
   *  exported comment letters when present. Generated client-side by
   *  EvidenceSnippet → "Pin to letter". */
  evidence_crop_url?: string | null;
  /** Count of historical corrections matching this finding's code_ref — set
   *  client-side via useSimilarCorrections, NOT persisted. Drives the
   *  "Corrected N× before" badge that surfaces the learning loop to reviewers. */
  similar_corrections_count?: number;
}

export type FindingStatus = "open" | "resolved" | "deferred";

/** Row shape returned from the `plan_reviews` table with embedded project. */
export interface PlanReviewRow {
  id: string;
  project_id: string;
  ai_check_status: string;
  ai_findings: unknown;
  file_urls: string[];
  round: number;
  created_at: string;
  finding_statuses?: Record<string, string> | null;
  previous_findings?: unknown;
  project?: ProjectInfo | null;
  qc_status?: string;
  qc_reviewer_id?: string | null;
  qc_notes?: string;
  reviewer_id?: string | null;
  /** Defaults to 'v2'. Legacy 'v1' rows are backfilled into deficiencies_v2.
   *  The viewer reads via adaptV2ToFindings() and disables write paths that
   *  mutate ai_findings (run AI check, new round, pin reposition). */
  pipeline_version?: string;
}
