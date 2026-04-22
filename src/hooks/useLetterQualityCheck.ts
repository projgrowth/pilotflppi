import { useMemo } from "react";
import { type DeficiencyV2Row } from "@/hooks/useReviewDashboard";

const HEDGE_PATTERNS: { code: string; pattern: RegExp; example: string }[] = [
  { code: "hedge_may", pattern: /\b(may|might)\b/i, example: "may / might" },
  { code: "hedge_appears", pattern: /\bappears? to\b/i, example: "appears to" },
  { code: "hedge_possibly", pattern: /\b(possibly|perhaps)\b/i, example: "possibly / perhaps" },
  { code: "hedge_seems", pattern: /\bseems? to\b/i, example: "seems to" },
  { code: "hedge_probably", pattern: /\b(probably|likely)\b/i, example: "probably / likely" },
  { code: "hedge_unclear", pattern: /\b(unclear|ambiguous)\b/i, example: "unclear / ambiguous" },
];

export type LetterCheckSeverity = "error" | "warning";

export interface LetterCheckIssue {
  severity: LetterCheckSeverity;
  code: string;
  message: string;
  /** When set, clicking the issue can jump to the offending finding. */
  findingId?: string;
}

export interface LetterCheckSummary {
  issues: LetterCheckIssue[];
  errorCount: number;
  warningCount: number;
  green: boolean;
}

interface Args {
  deficiencies: DeficiencyV2Row[];
  /** Optional letter draft body — if absent, hedge-word checks are skipped. */
  letterDraft?: string | null;
}

/**
 * Pure validation hook that powers the comment-letter quality gate. Returns
 * a stable, jump-able list of issues that the dashboard surfaces before the
 * reviewer sends anything to a contractor.
 */
export function useLetterQualityCheck({
  deficiencies,
  letterDraft,
}: Args): LetterCheckSummary {
  return useMemo(() => {
    const issues: LetterCheckIssue[] = [];

    // We only judge the live deficiencies — superseded/overturned ones
    // don't make it into the letter anyway.
    const live = deficiencies.filter(
      (d) =>
        d.verification_status !== "superseded" &&
        d.verification_status !== "overturned",
    );

    for (const d of live) {
      if (d.reviewer_disposition === null) {
        issues.push({
          severity: "error",
          code: `disposition_missing:${d.id}`,
          message: `${d.def_number} — disposition not set`,
          findingId: d.id,
        });
      }
      if (d.reviewer_disposition === "confirm") {
        const ref = d.code_reference;
        const hasCode =
          ref && (ref.code || ref.section) && `${ref.section ?? ""}`.trim().length > 0;
        if (!hasCode) {
          issues.push({
            severity: "error",
            code: `code_ref_missing:${d.id}`,
            message: `${d.def_number} — confirmed without a code reference`,
            findingId: d.id,
          });
        }
        if (!d.sheet_refs || d.sheet_refs.length === 0) {
          issues.push({
            severity: "warning",
            code: `sheet_ref_missing:${d.id}`,
            message: `${d.def_number} — no sheet reference (will read "see plans")`,
            findingId: d.id,
          });
        }
      }
      if (d.requires_human_review && d.reviewer_disposition === null) {
        issues.push({
          severity: "warning",
          code: `human_review_pending:${d.id}`,
          message: `${d.def_number} — flagged for human review but unreviewed`,
          findingId: d.id,
        });
      }
      // Citation grounding: only block confirmed findings — rejected ones
      // won't ship in the letter regardless.
      if (d.reviewer_disposition === "confirm") {
        // citation_status="not_found" fires on every finding when fbc_code_sections
        // is unseeded. Suppress it — a separate banner in the UI handles the
        // "database not populated" state so reviewers aren't buried in noise.
        if (d.citation_status === "hallucinated") {
          issues.push({
            severity: "error",
            code: `citation_hallucinated:${d.id}`,
            message: `${d.def_number} — citation appears hallucinated (no parseable section)`,
            findingId: d.id,
          });
        } else if (d.citation_status === "mismatch") {
          issues.push({
            severity: "warning",
            code: `citation_mismatch:${d.id}`,
            message: `${d.def_number} — cited section text doesn't match canonical FBC wording`,
            findingId: d.id,
          });
        }
        // not_found is intentionally omitted until fbc_code_sections is seeded.
      }
    }

    if (typeof letterDraft === "string" && letterDraft.trim().length > 0) {
      for (const h of HEDGE_PATTERNS) {
        if (h.pattern.test(letterDraft)) {
          issues.push({
            severity: "warning",
            code: h.code,
            message: `Letter contains hedge phrasing ("${h.example}") — contractors push back on these`,
          });
        }
      }
    }

    const errorCount = issues.filter((i) => i.severity === "error").length;
    const warningCount = issues.filter((i) => i.severity === "warning").length;
    return {
      issues,
      errorCount,
      warningCount,
      green: errorCount === 0 && warningCount === 0,
    };
  }, [deficiencies, letterDraft]);
}
