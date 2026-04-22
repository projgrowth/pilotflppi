/**
 * Pre-send sanity checks for the comment letter and the underlying findings.
 * Pure client-side validators — surfaced in a blocking dialog before sending
 * the letter to a contractor. Keeps placeholder text, missing FBC sections,
 * and empty descriptions from leaving the firm.
 */
import type { Finding } from "@/types";
import type { FindingStatus } from "@/components/FindingStatusFilter";

export type LintSeverity = "error" | "warning";

export interface LintIssue {
  severity: LintSeverity;
  /** Stable code so we can dedupe + test. */
  code: string;
  message: string;
}

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\[TODO\]/i,
  /\bXXX+\b/,
  /\bTBD\b/,
  /\{\{[^}]+\}\}/, // unfilled {{template}} tokens
  /\bLOREM IPSUM\b/i,
  /\[\s*INSERT[^\]]*\]/i,
];

export function lintCommentLetter(letter: string, findings: Finding[], findingStatuses: Record<string, FindingStatus>): LintIssue[] {
  const issues: LintIssue[] = [];
  const text = letter.trim();

  if (!text) {
    issues.push({ severity: "error", code: "empty_letter", message: "Letter body is empty." });
  } else if (text.length < 80) {
    issues.push({ severity: "warning", code: "short_letter", message: "Letter looks unusually short — verify it covers all open findings." });
  }

  for (const pat of PLACEHOLDER_PATTERNS) {
    const m = letter.match(pat);
    if (m) {
      issues.push({
        severity: "error",
        code: `placeholder:${pat.source}`,
        message: `Letter contains placeholder text "${m[0]}" — replace before sending.`,
      });
    }
  }

  const openFindings = findings.filter((_, i) => (findingStatuses[i] || "open") === "open");
  if (findings.length > 0 && openFindings.length === 0) {
    issues.push({
      severity: "warning",
      code: "no_open_findings",
      message: "No findings are still open. Are you sure you need to send a comment letter?",
    });
  }

  openFindings.forEach((f, i) => {
    if (!f.description || f.description.trim().length < 10) {
      issues.push({
        severity: "error",
        code: `finding_no_desc:${i}`,
        message: `Open finding #${i + 1} (${f.code_ref || "no code"}) has no description.`,
      });
    }
    if (!f.code_ref || f.code_ref.trim().length === 0) {
      issues.push({
        severity: "error",
        code: `finding_no_code:${i}`,
        message: `Open finding #${i + 1} is missing an FBC section reference.`,
      });
    }
    if (!f.page || f.page.trim().length === 0 || f.page.toLowerCase() === "unknown") {
      issues.push({
        severity: "warning",
        code: `finding_no_sheet:${i}`,
        message: `Open finding #${i + 1} (${f.code_ref || "no code"}) has no sheet reference.`,
      });
    }
  });

  return issues;
}

export function hasBlockingIssues(issues: LintIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}
