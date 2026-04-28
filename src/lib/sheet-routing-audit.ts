/**
 * Sheet routing audit
 *
 * After `sheet_map` runs, the AI-assigned discipline on each sheet drives
 * which discipline expert reviews it. A misroute (e.g. a P-101 plumbing
 * sheet labeled Architectural) silently strips that sheet from the
 * plumbing reviewer's batch — findings get missed.
 *
 * This is a deterministic check: scan each sheet's printed title +
 * sheet_ref for canonical discipline tokens, and if the assigned
 * discipline disagrees with the unambiguous evidence, flag a misroute
 * with a confident suggested discipline. The reviewer applies the fix
 * via `applySheetReassignment` which updates `sheet_coverage`.
 *
 * Conservative on purpose: we only flag when the prefix or title contains
 * an unambiguous token AND the assigned discipline is different. Anything
 * borderline is left alone (no false alarms in the banner).
 */

import { supabase } from "@/integrations/supabase/client";

export interface SheetRow {
  id: string;
  sheet_ref: string;
  sheet_title: string | null;
  discipline: string | null;
  page_index: number | null;
}

export interface MisroutedSheet {
  id: string;
  sheet_ref: string;
  sheet_title: string | null;
  page_index: number | null;
  current: string;
  suggested: string;
  reason: string;
}

// Canonical sheet-prefix → discipline. Only includes prefixes that are
// industry-standard and unambiguous in Florida title blocks.
const PREFIX_MAP: Array<[RegExp, string, string]> = [
  [/^A[-\s.]?\d/i, "Architectural", "Sheet number prefixed with A-"],
  [/^S[-\s.]?\d/i, "Structural", "Sheet number prefixed with S-"],
  [/^M[-\s.]?\d/i, "MEP", "Sheet number prefixed with M- (mechanical)"],
  [/^P[-\s.]?\d/i, "MEP", "Sheet number prefixed with P- (plumbing)"],
  [/^E[-\s.]?\d/i, "MEP", "Sheet number prefixed with E- (electrical)"],
  [/^FP[-\s.]?\d/i, "Fire Protection", "Sheet number prefixed with FP-"],
  [/^FA[-\s.]?\d/i, "Fire Protection", "Sheet number prefixed with FA-"],
  [/^LS[-\s.]?\d/i, "Life Safety", "Sheet number prefixed with LS-"],
  [/^C[-\s.]?\d/i, "Civil", "Sheet number prefixed with C-"],
  [/^L[-\s.]?\d/i, "Landscape", "Sheet number prefixed with L-"],
];

// Title keywords. Only matches if the keyword stands alone — substring matches
// like "architectural plumbing schedule" wouldn't be considered confident.
const TITLE_TOKENS: Array<[RegExp, string]> = [
  [/\bplumbing\b/i, "MEP"],
  [/\bmechanical\b/i, "MEP"],
  [/\belectrical\b/i, "MEP"],
  [/\bhvac\b/i, "MEP"],
  [/\bstructural\b/i, "Structural"],
  [/\bfoundation plan\b/i, "Structural"],
  [/\bframing plan\b/i, "Structural"],
  [/\barchitectural\b/i, "Architectural"],
  [/\bfloor plan\b/i, "Architectural"],
  [/\bfire protection\b/i, "Fire Protection"],
  [/\bfire alarm\b/i, "Fire Protection"],
  [/\bsprinkler\b/i, "Fire Protection"],
  [/\blife safety\b/i, "Life Safety"],
  [/\begress plan\b/i, "Life Safety"],
  [/\bcivil\b/i, "Civil"],
  [/\bsite plan\b/i, "Civil"],
  [/\blandscape\b/i, "Landscape"],
  [/\benergy\b/i, "Energy"],
];

function detectExpected(row: SheetRow): { discipline: string; reason: string } | null {
  const ref = (row.sheet_ref ?? "").trim();
  const title = (row.sheet_title ?? "").trim();

  // Skip placeholder sheets — sheet_map uses X-NA / X-<idx> for unreadable
  // pages, and there's nothing to audit.
  if (/^X[-A-Z0-9]*$/i.test(ref)) return null;

  for (const [re, disc, reason] of PREFIX_MAP) {
    if (re.test(ref)) return { discipline: disc, reason };
  }
  for (const [re, disc] of TITLE_TOKENS) {
    if (title && re.test(title)) {
      return { discipline: disc, reason: `Title contains "${title.match(re)?.[0]}"` };
    }
  }
  return null;
}

export function auditSheetRouting(rows: SheetRow[]): MisroutedSheet[] {
  const misrouted: MisroutedSheet[] = [];
  for (const row of rows) {
    const current = (row.discipline ?? "General").trim();
    const expected = detectExpected(row);
    if (!expected) continue;
    if (current === expected.discipline) continue;
    // "General" sheets that we can confidently route are also worth flagging.
    misrouted.push({
      id: row.id,
      sheet_ref: row.sheet_ref,
      sheet_title: row.sheet_title,
      page_index: row.page_index,
      current,
      suggested: expected.discipline,
      reason: expected.reason,
    });
  }
  return misrouted;
}

export async function applySheetReassignment(args: {
  sheetCoverageId: string;
  newDiscipline: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from("sheet_coverage")
    .update({ discipline: args.newDiscipline })
    .eq("id", args.sheetCoverageId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
