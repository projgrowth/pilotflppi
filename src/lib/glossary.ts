/**
 * Plain-English glossary for jargon that shows up in the reviewer UI
 * (chips, badges, status pills). Sourced once and rendered through
 * <MetricExplainer term="…" /> so we never duplicate copy across surfaces.
 */
export interface GlossaryEntry {
  label: string;
  body: string;
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  citation_status: {
    label: "Citation status",
    body:
      "Whether the cited Florida Building Code section actually contains the language the AI quoted. 'Grounded' = matched against the canonical FBC text on file. 'Unverified' = the citation hasn't been reconciled and may be hallucinated.",
  },
  verification_status: {
    label: "Verification status",
    body:
      "A second AI (the Verifier) re-reads the original sheet to confirm the finding's evidence really exists. 'Verified' means it agreed; 'rejected' means the original finding was likely wrong.",
  },
  challenger: {
    label: "Challenger pass",
    body:
      "An adversarial pass that argues the opposite case for each finding. If the Challenger can't break a finding, that's a strong confidence signal for the reviewer.",
  },
  dedupe_audit: {
    label: "Dedupe audit",
    body:
      "When the discipline experts produce overlapping findings, dedupe merges them. The audit shows which originals were collapsed into which surviving finding.",
  },
  sheet_coverage: {
    label: "Sheet coverage",
    body:
      "Percentage of expected sheets the pipeline actually analyzed. Low coverage usually means PDF rendering failed on certain pages, so findings on those sheets would be missed.",
  },
  threshold_building: {
    label: "Threshold building (F.S. 553.79)",
    body:
      "A Florida statutory category for buildings over 3 stories, over 50 ft, or assemblies over 5,000 sf with 500+ occupants. They require a designated Special Inspector independent of the EOR.",
  },
  reviewer_licensed: {
    label: "Reviewer licensed",
    body:
      "F.S. 553.791(2) requires the signing reviewer to hold a Florida license matching every discipline in the comment letter. Missing a discipline blocks letter send unless overridden.",
  },
  needs_human_review: {
    label: "Needs human review",
    body:
      "The AI's confidence for this finding fell below the auto-accept threshold (typically 0.7), or the verifier and the discipline expert disagreed. A human must decide before the letter goes out.",
  },
  permit_blocker: {
    label: "Permit blocker",
    body:
      "Marks findings severe enough that the AHJ would deny the permit if not corrected. Used for triage priority and statutory-clock notifications.",
  },
  life_safety: {
    label: "Life-safety flag",
    body:
      "Findings with direct egress, fire-rated assembly, or structural-collapse implications. Always shown first in the comment letter and inspection priority.",
  },
  notice_filed: {
    label: "Notice to Building Official",
    body:
      "F.S. 553.791(4) requires the private provider to file written notice with the AHJ before plan review begins. The 30-day statutory clock starts at this filing.",
  },
  affidavit_signed: {
    label: "Compliance affidavit",
    body:
      "Sworn statement under F.S. 553.791(7) that the plans comply with the Florida Building Code. Required on the comment letter for the AHJ to accept the review.",
  },
  triage: {
    label: "Triage status",
    body:
      "Every finding must be dispositioned (accept / reject / needs more info) before the letter sends. Open findings without a disposition block delivery.",
  },
  qc: {
    label: "Letter QC",
    body:
      "An automated quality-check pass that scans the draft letter for missing fields, broken references, and stylistic issues before send.",
  },
  project_dna: {
    label: "Project DNA",
    body:
      "Title-block facts the pipeline extracted (occupancy, construction type, code edition, square footage). Missing fields prevent code-grounded findings from being generated.",
  },
  pipeline: {
    label: "Pipeline",
    body:
      "The end-to-end AI workflow: prepare pages → sheet map → submittal check → DNA → discipline review → cross-check → verify → ground citations → dedupe → deferred scope → prioritize → letter.",
  },
};

export function getGlossaryEntry(term: string): GlossaryEntry | null {
  return GLOSSARY[term] ?? null;
}
