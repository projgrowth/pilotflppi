// stages/callout-graph.ts — deterministic cross-sheet reference graph.
//
// Runs after sheet_map (so we know which sheets exist) and before discipline_review.
// Pure regex/string work — zero AI cost, zero LLM tokens.
//
// What it does:
//   1. Reads `plan_review_page_text.full_text` for every page in this review.
//   2. Scans for the standard callout patterns architects/engineers use:
//        - Detail bubbles:   "4/A5.2", "12/S-301"        (kind="detail")
//        - Section refs:     "SECTION A-A on A4.1"        (kind="section")
//        - "SEE SHEET" notes: "SEE SHEET M-101"           (kind="sheet_ref")
//   3. Resolves each callout's target_sheet_ref against `sheet_coverage`.
//   4. Persists every callout to `callout_references`.
//   5. Emits ONE deficiency per unresolved target sheet (deduped) so the
//      reviewer sees "Sheet A2.1 references detail 4/A5.2 but A5.2 was not
//      submitted" instead of dozens of identical findings.
//
// Failure mode: if no page text exists yet (legacy review uploaded before
// the text-layer change), the stage returns { skipped: true } and the
// chain continues — no findings are emitted, nothing breaks.

import type { Admin } from "../_shared/supabase.ts";
import { canonicalDiscipline } from "../_shared/types.ts";

interface CalloutMatch {
  raw: string;
  kind: "detail" | "section" | "sheet_ref";
  target_sheet_ref: string;
  target_detail: string | null;
}

// Detail bubble: digit(s) / sheet token (sheet token = letter prefix + digits,
// optional dash, optional decimal). Bounded by word boundaries so we don't
// match "1/2" in a fraction or "1/4" CALL inside a note.
const DETAIL_BUBBLE = /\b(\d{1,3})\s*\/\s*([A-Z]{1,3}-?\d{1,3}(?:\.\d{1,2})?)\b/g;
// "SEE SHEET A-101" / "SEE SHEET A101" / "SEE A-101"
const SEE_SHEET = /\bSEE\s+(?:SHEET\s+)?([A-Z]{1,3}-?\d{1,3}(?:\.\d{1,2})?)\b/gi;
// "SECTION A-A on/at sheet A4.1" — capture the trailing sheet token only,
// the section letter itself isn't a sheet target.
const SECTION_ON_SHEET = /\bSECTION\s+[A-Z\d-]+\s+(?:ON|AT)\s+(?:SHEET\s+)?([A-Z]{1,3}-?\d{1,3}(?:\.\d{1,2})?)\b/gi;

function normalizeSheet(token: string): string {
  // Architects write "A-101" and "A101" interchangeably. Normalize to the
  // dash-less form for matching but keep the raw form for display.
  return token.toUpperCase().replace(/-/g, "");
}

function extractCallouts(text: string): CalloutMatch[] {
  if (!text || text.length < 4) return [];
  const out: CalloutMatch[] = [];
  for (const m of text.matchAll(DETAIL_BUBBLE)) {
    out.push({
      raw: m[0],
      kind: "detail",
      target_sheet_ref: m[2].toUpperCase(),
      target_detail: m[1],
    });
  }
  for (const m of text.matchAll(SEE_SHEET)) {
    out.push({
      raw: m[0],
      kind: "sheet_ref",
      target_sheet_ref: m[1].toUpperCase(),
      target_detail: null,
    });
  }
  for (const m of text.matchAll(SECTION_ON_SHEET)) {
    out.push({
      raw: m[0],
      kind: "section",
      target_sheet_ref: m[1].toUpperCase(),
      target_detail: null,
    });
  }
  return out;
}

export async function stageCalloutGraph(
  admin: Admin,
  planReviewId: string,
  firmId: string | null,
) {
  // 1. Pull every page's text. Reviews with no text-layer rows skip cleanly.
  const { data: textPages } = await admin
    .from("plan_review_page_text")
    .select("page_index, sheet_ref, full_text, has_text_layer")
    .eq("plan_review_id", planReviewId);
  const pages = (textPages ?? []) as Array<{
    page_index: number;
    sheet_ref: string | null;
    full_text: string | null;
    has_text_layer: boolean;
  }>;
  if (pages.length === 0) {
    return { skipped: true, reason: "no_page_text" };
  }

  // 2. Build the set of sheets that DO exist in this submittal so we can
  // resolve targets. Falls back to page-text sheet_refs if sheet_coverage
  // hasn't been written yet.
  const { data: coverage } = await admin
    .from("sheet_coverage")
    .select("sheet_ref, page_index")
    .eq("plan_review_id", planReviewId);
  const existingSheets = new Set<string>();
  const sheetToPage = new Map<string, number>();
  for (const row of (coverage ?? []) as Array<{ sheet_ref: string | null; page_index: number | null }>) {
    if (row.sheet_ref) {
      const k = normalizeSheet(row.sheet_ref);
      existingSheets.add(k);
      if (typeof row.page_index === "number") sheetToPage.set(k, row.page_index);
    }
  }
  for (const p of pages) {
    if (p.sheet_ref) existingSheets.add(normalizeSheet(p.sheet_ref));
  }

  // Also pull source-page sheet_refs from sheet_coverage so the source row
  // is labelled with the sheet number, not a raw page index.
  const sourceSheetByPage = new Map<number, string>();
  for (const row of (coverage ?? []) as Array<{ sheet_ref: string | null; page_index: number | null }>) {
    if (typeof row.page_index === "number" && row.sheet_ref) {
      sourceSheetByPage.set(row.page_index, row.sheet_ref);
    }
  }

  // 3. Scan every page, accumulate callouts, dedupe by (source_page, raw).
  const calloutRows: Array<{
    plan_review_id: string;
    firm_id: string | null;
    source_page: number;
    source_sheet_ref: string | null;
    raw_text: string;
    callout_kind: string;
    target_sheet_ref: string;
    target_detail: string | null;
    resolved: boolean;
  }> = [];
  const seenKey = new Set<string>();
  let totalFound = 0;

  for (const p of pages) {
    if (!p.has_text_layer || !p.full_text) continue;
    // Cap per-page scan to keep stage runtime predictable on enormous note blocks.
    const text = p.full_text.slice(0, 80_000);
    const matches = extractCallouts(text);
    for (const m of matches) {
      const k = `${p.page_index}|${m.raw}`;
      if (seenKey.has(k)) continue;
      seenKey.add(k);
      totalFound += 1;
      const targetKey = normalizeSheet(m.target_sheet_ref);
      // Self-references (sheet pointing at itself) are noise — skip them.
      const sourceKey = p.sheet_ref ? normalizeSheet(p.sheet_ref) : null;
      if (sourceKey && sourceKey === targetKey) continue;
      calloutRows.push({
        plan_review_id: planReviewId,
        firm_id: firmId,
        source_page: p.page_index,
        source_sheet_ref: sourceSheetByPage.get(p.page_index) ?? p.sheet_ref ?? null,
        raw_text: m.raw.slice(0, 200),
        callout_kind: m.kind,
        target_sheet_ref: m.target_sheet_ref,
        target_detail: m.target_detail,
        resolved: existingSheets.has(targetKey),
      });
    }
  }

  // 4. Replace any prior run's callouts so re-runs don't duplicate.
  await admin.from("callout_references").delete().eq("plan_review_id", planReviewId);
  if (calloutRows.length > 0) {
    for (let i = 0; i < calloutRows.length; i += 200) {
      await admin.from("callout_references").insert(calloutRows.slice(i, i + 200));
    }
  }

  // 5. Emit one deficiency per unique unresolved target sheet.
  const unresolvedByTarget = new Map<string, {
    target_sheet_ref: string;
    sources: Array<{ source_sheet_ref: string | null; raw: string }>;
  }>();
  for (const c of calloutRows) {
    if (c.resolved) continue;
    const k = c.target_sheet_ref;
    const entry = unresolvedByTarget.get(k) ?? {
      target_sheet_ref: c.target_sheet_ref,
      sources: [],
    };
    if (entry.sources.length < 6) {
      entry.sources.push({ source_sheet_ref: c.source_sheet_ref, raw: c.raw_text });
    }
    unresolvedByTarget.set(k, entry);
  }

  let findingsInserted = 0;
  if (unresolvedByTarget.size > 0) {
    // Pull the next available def_number prefix so we don't collide with
    // discipline_review's numbering. Cross-sheet items get an "X-" prefix.
    const { count: existingCount } = await admin
      .from("deficiencies_v2")
      .select("id", { count: "exact", head: true })
      .eq("plan_review_id", planReviewId)
      .like("def_number", "X-%");
    let nextNum = (existingCount ?? 0) + 1;

    const rows = Array.from(unresolvedByTarget.values()).map((u) => {
      const sourceList = u.sources
        .map((s) => `${s.source_sheet_ref ?? "(unknown sheet)"}: "${s.raw}"`)
        .join("; ");
      const finding = `Sheet ${u.target_sheet_ref} is referenced by ${u.sources.length} callout${u.sources.length === 1 ? "" : "s"} but was not submitted. References: ${sourceList}.`;
      const requiredAction = `Submit sheet ${u.target_sheet_ref} or remove/redirect the cross-references.`;
      const def_number = `X-${String(nextNum).padStart(3, "0")}`;
      nextNum += 1;
      return {
        plan_review_id: planReviewId,
        firm_id: firmId,
        def_number,
        discipline: canonicalDiscipline("cross_sheet"),
        sheet_refs: u.sources
          .map((s) => s.source_sheet_ref)
          .filter((s): s is string => !!s),
        code_reference: {},
        finding,
        evidence: u.sources.map((s) => s.raw),
        priority: "medium" as const,
        life_safety_flag: false,
        permit_blocker: true, // Missing referenced sheets block permit issuance
        liability_flag: false,
        requires_human_review: false,
        confidence_score: 0.99, // Deterministic — high confidence
        confidence_basis: "Deterministic cross-sheet reference parser",
        verification_status: "verified", // Pure text match, no AI guess
        citation_status: "not_applicable",
        verified_by_challenger: true,
        required_action: requiredAction,
      };
    });

    for (let i = 0; i < rows.length; i += 50) {
      const { error } = await admin.from("deficiencies_v2").insert(rows.slice(i, i + 50));
      if (!error) findingsInserted += rows.slice(i, i + 50).length;
    }
  }

  return {
    pages_scanned: pages.length,
    callouts_found: totalFound,
    callouts_resolved: calloutRows.filter((c) => c.resolved).length,
    callouts_unresolved: calloutRows.filter((c) => !c.resolved).length,
    unique_missing_sheets: unresolvedByTarget.size,
    findings_inserted: findingsInserted,
  };
}
