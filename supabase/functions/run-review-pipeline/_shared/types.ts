// Pipeline-wide types + stage chain definitions.
// Imported by every stage module + the orchestrator.

export type Stage =
  | "upload"
  | "prepare_pages"
  | "sheet_map"
  | "callout_graph"
  | "submittal_check"
  | "dna_extract"
  | "discipline_review"
  | "critic"
  | "verify"
  | "dedupe"
  | "ground_citations"
  | "challenger"
  | "cross_check"
  | "deferred_scope"
  | "prioritize"
  | "complete";

// Full canonical stage list (kept for backward-compat callers passing
// `start_from`). Default execution uses CORE_STAGES; opt-in DEEP_STAGES
// runs the heavier QA passes after core finishes.
export const STAGES: Stage[] = [
  "upload",
  "prepare_pages",
  "sheet_map",
  "callout_graph",
  "submittal_check",
  "dna_extract",
  "discipline_review",
  "critic",
  "verify",
  "dedupe",
  "ground_citations",
  "challenger",
  "cross_check",
  "deferred_scope",
  "prioritize",
  "complete",
];

// Core Review = the minimum precise pipeline. Fast time-to-results.
// `prepare_pages` here is a manifest-validation fast-pass (the wizard
// pre-rasterizes in the browser); it does NOT loop through MuPDF chunks
// in the default path.
//
// `submittal_check` runs right after sheet_map and before any AI review work:
// if a 5,000+ sf commercial set is missing entire trades (no S/M/P/E/FP), we
// raise ONE permit-blocker finding so reviewers don't waste cycles auditing
// architectural-only against a code that demands the full submittal.
//
// `ground_citations` lives in CORE (not DEEP) so every shipped run validates
// every finding's FBC citation against `fbc_code_sections`. The cost is one
// cheap deterministic comparison per finding (no AI call) — worth it because
// it's the difference between a reviewer signing a letter with verified code
// references vs. shipping AI guesses.
//
// `challenger` runs after grounding so the adversarial pass can see the
// canonical code text. It self-filters to only high-stakes + low-confidence
// findings, so the cost is bounded.
export const CORE_STAGES: Stage[] = [
  "upload",
  "prepare_pages",
  "sheet_map",
  // callout_graph is deterministic (regex over plan_review_page_text). It
  // produces verified cross_sheet findings BEFORE any AI runs and gives
  // submittal_check + discipline_review a richer view of what's missing.
  "callout_graph",
  "submittal_check",
  "dna_extract",
  "discipline_review",
  "critic",
  "dedupe",
  "ground_citations",
  // verify runs in CORE so every finding gets an adversarial verdict before
  // the letter-readiness gate is evaluated.
  "verify",
  "challenger",
  "complete",
];

// Deep QA = optional secondary pass. Runs only when explicitly invoked
// with mode='deep'. Reuses existing core artifacts (deficiencies,
// project_dna, sheet_coverage) — does not re-run discipline_review.
// `ground_citations` and `verify` were promoted to CORE; deep keeps the
// heavier QA passes only.
export const DEEP_STAGES: Stage[] = [
  "cross_check",
  "deferred_scope",
  "prioritize",
];

export type PipelineMode = "core" | "deep" | "full";

export function stagesForMode(mode: PipelineMode): Stage[] {
  if (mode === "deep") return DEEP_STAGES;
  if (mode === "full") return STAGES;
  return CORE_STAGES;
}

export type ChatMessage = {
  role: "system" | "user";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
};

export const DISCIPLINES = [
  "Architectural",
  "Structural",
  "Energy",
  "Accessibility",
  "Product Approvals",
  "MEP",
  "Life Safety",
  "Civil",
  "Landscape",
];

/**
 * Map AI-extracted sheet_coverage.discipline → our internal DISCIPLINES list.
 * The sheet_map stage uses an enum {General, Architectural, Structural, MEP,
 * Energy, Accessibility, Civil, Landscape, Other}. We don't have a 1:1 for
 * "Product Approvals" (that's a doc category, not a sheet) and "Life Safety"
 * is sometimes labeled Architectural. This normalizer keeps routing honest.
 */
export function normalizeAIDiscipline(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const k = raw.trim().toLowerCase();
  if (k === "general" || k === "other") return null;
  if (k === "architectural" || k === "arch") return "Architectural";
  if (k === "structural" || k === "struct") return "Structural";
  if (k === "mep" || k === "mechanical" || k === "electrical" || k === "plumbing") return "MEP";
  if (k === "fire protection" || k === "fp") return "Life Safety"; // FBC Ch.9 suppression owned by Life Safety expert
  if (k === "energy") return "Energy";
  if (k === "accessibility" || k === "ada") return "Accessibility";
  if (k === "civil" || k === "site") return "Civil";
  if (k === "landscape" || k === "irrigation") return "Landscape";
  if (k === "life safety" || k === "ls") return "Life Safety";
  return null;
}

/**
 * @deprecated Prefer `sheet_coverage.discipline` (AI-extracted from the title block).
 * Last-resort routing when the title-block parser couldn't classify a sheet.
 * Letter-prefix only; no semantic awareness. Kept narrow on purpose — better
 * to send the sheet to "general" than to mis-route it.
 */
export function disciplineForSheetFallback(sheetRef: string): string | null {
  const p = sheetRef.trim().toUpperCase()[0];
  switch (p) {
    case "A":
      return "Architectural";
    case "S":
      return "Structural";
    case "M":
    case "P":
    case "E":
    case "F":
      return "MEP";
    case "C":
      return "Civil";
    case "L":
      return "Landscape";
    default:
      return null; // G-, T-, cover sheets → general notes, sent to every call
  }
}

/**
 * Canonical lowercase discipline slugs used across all stages and stored
 * directly into deficiencies_v2.discipline. Frontend lookups (icons, colors,
 * labels, dedupe ownership) all key off this list.
 */
export const CANONICAL_DISCIPLINES = [
  "general",
  "architectural",
  "structural",
  "life_safety",
  "fire",
  "mep",
  "mechanical",
  "electrical",
  "plumbing",
  "energy",
  "ada",
  "civil",
  "site",
  "landscape",
  "cross_sheet",
  "product_approvals",
  "administrative",
] as const;

/**
 * Map any AI- or legacy-emitted discipline label to its canonical slug.
 * Mirrors src/lib/county-utils.ts:normalizeDiscipline so write-time and
 * read-time normalization can never drift.
 */
export function canonicalDiscipline(raw: string | null | undefined): string {
  if (!raw) return "general";
  const k = raw.toLowerCase().trim().replace(/[\s/-]+/g, "_");
  const aliases: Record<string, string> = {
    arch: "architectural",
    architecture: "architectural",
    architectural: "architectural",
    struct: "structural",
    structural: "structural",
    life_safety: "life_safety",
    "life safety": "life_safety",
    ls: "life_safety",
    egress: "life_safety",
    safety: "life_safety",
    fire: "fire",
    fire_protection: "fire",
    fp: "fire",
    mech: "mechanical",
    mechanical: "mechanical",
    hvac: "mechanical",
    elec: "electrical",
    electrical: "electrical",
    plumb: "plumbing",
    plumbing: "plumbing",
    mep: "mep",
    energy: "energy",
    energy_conservation: "energy",
    ada: "ada",
    accessibility: "ada",
    site: "site",
    site_civil: "site",
    civil: "civil",
    landscape: "landscape",
    irrigation: "landscape",
    general: "general",
    other: "general",
    cross_sheet: "cross_sheet",
    "cross-sheet": "cross_sheet",
    product_approvals: "product_approvals",
    "product approvals": "product_approvals",
    administrative: "administrative",
    building: "architectural",
  };
  return aliases[k] ?? k;
}

export function mapSeverityToPriority(severity: string): string {
  const s = severity.trim().toLowerCase();
  if (s === "critical" || s === "high") return "high";
  if (s === "minor" || s === "low") return "low";
  return "medium";
}

// Sentinel error class written to pipeline_error_log + surfaced to the client
// so the dashboard can show a one-click "Re-prepare in browser" CTA.
export const NEEDS_BROWSER_RASTERIZATION = "needs_browser_rasterization";
