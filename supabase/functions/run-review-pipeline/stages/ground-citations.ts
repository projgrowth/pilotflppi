// Stage: ground_citations.
// Compares each finding's cited FBC section against canonical fbc_code_sections
// rows. Verdicts: verified | mismatch | not_found | hallucinated. Then attaches
// a one-click visual receipt (signed sheet image URL) to each finding so
// reviewers don't have to flip back to the PDF to confirm context.

import { createClient } from "../_shared/supabase.ts";
import { signedSheetUrls } from "../_shared/storage.ts";

/** Normalize a code-section identifier for canonical lookup. */
function normalizeCitationSection(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw
    .replace(/sec(?:tion)?\.?/i, "")
    .replace(/[§¶]/g, "")
    .trim()
    .match(/[A-Z]?\d+(?:\.\d+)*[a-z]?/i);
  return m ? m[0].toUpperCase() : null;
}

/** Cheap token overlap (Jaccard) for "does the AI's text resemble the canonical requirement?". */
function citationOverlapScore(aiText: string, canonical: string): number {
  const tok = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3),
    );
  const a = tok(aiText);
  const b = tok(canonical);
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

type GroundingRow = {
  id: string;
  finding: string;
  required_action: string;
  code_reference:
    | { code?: string | null; section?: string | null; edition?: string | null }
    | null;
};

export async function stageGroundCitations(
  admin: ReturnType<typeof createClient>,
  planReviewId: string,
) {
  const { data: defsRaw, error } = await admin
    .from("deficiencies_v2")
    .select("id, finding, required_action, code_reference")
    .eq("plan_review_id", planReviewId)
    .neq("status", "resolved")
    .neq("status", "waived")
    .neq("verification_status", "superseded");
  if (error) throw error;

  const defs = (defsRaw ?? []) as GroundingRow[];
  if (defs.length === 0) {
    return { examined: 0, verified: 0, mismatch: 0, not_found: 0, hallucinated: 0 };
  }

  type Key = { code: string; section: string; edition: string | null };
  const keyOf = (r: GroundingRow): Key | null => {
    const section = normalizeCitationSection(r.code_reference?.section);
    if (!section) return null;
    const code = (r.code_reference?.code || "FBC").toUpperCase();
    const edition = r.code_reference?.edition?.trim() || null;
    return { code, section, edition };
  };

  function parentSections(s: string): string[] {
    const parts = s.split(".");
    const out: string[] = [];
    for (let i = parts.length; i >= 1; i--) out.push(parts.slice(0, i).join("."));
    return out;
  }
  const distinctSections = Array.from(
    new Set(
      defs
        .map((d) => keyOf(d))
        .filter((k): k is Key => !!k)
        .flatMap((k) => parentSections(k.section)),
    ),
  );

  const { data: canonRaw, error: canonErr } =
    distinctSections.length > 0
      ? await admin
          .from("fbc_code_sections")
          .select("code, section, edition, title, requirement_text")
          .in("section", distinctSections)
      : { data: [], error: null };
  if (canonErr) throw canonErr;

  type Canon = {
    code: string;
    section: string;
    edition: string;
    title: string;
    requirement_text: string;
  };
  const canon = (canonRaw ?? []) as Canon[];

  function lookup(k: Key): { hit: Canon; matchedSection: string } | null {
    for (const section of parentSections(k.section)) {
      let hit =
        (k.edition &&
          canon.find(
            (c) =>
              c.code === k.code && c.section === section && c.edition === k.edition,
          )) ||
        null;
      if (!hit) hit = canon.find((c) => c.code === k.code && c.section === section) ?? null;
      if (!hit) hit = canon.find((c) => c.section === section) ?? null;
      if (hit) return { hit, matchedSection: section };
    }
    return null;
  }

  const counts = { verified: 0, mismatch: 0, not_found: 0, hallucinated: 0 };
  const now = new Date().toISOString();

  for (const def of defs) {
    const key = keyOf(def);
    let status: "verified" | "mismatch" | "not_found" | "hallucinated";
    let score: number | null = null;
    let canonText: string | null = null;
    let matchedSection: string | null = null;

    if (!key) {
      status = "hallucinated";
    } else {
      const found = lookup(key);
      if (!found) {
        status = "not_found";
      } else {
        const { hit, matchedSection: ms } = found;
        matchedSection = ms;
        canonText = `${hit.code} ${hit.section} (${hit.edition}) — ${hit.title}: ${hit.requirement_text}`.slice(
          0,
          1500,
        );
        const aiBlob = `${def.finding} ${def.required_action}`;
        score = citationOverlapScore(aiBlob, hit.requirement_text);
        const aiBlobLc = aiBlob.toLowerCase();
        const sectionLc = ms.toLowerCase();
        const mentionsSection = aiBlobLc.includes(sectionLc) ||
          aiBlobLc.includes(key.section.toLowerCase());
        const usedParent = ms !== key.section;
        if (usedParent && mentionsSection) {
          status = "verified";
        } else {
          status = score >= 0.30 && mentionsSection ? "verified" : "mismatch";
        }
      }
    }
    counts[status]++;

    const needsHumanReview =
      status === "mismatch" || status === "hallucinated" || status === "not_found";
    const update: Record<string, unknown> = {
      citation_status: status,
      citation_match_score: score,
      citation_canonical_text: canonText,
      citation_grounded_at: now,
    };
    if (matchedSection && matchedSection !== key?.section) {
      update.evidence_crop_meta = { matched_parent_section: matchedSection };
    }
    if (needsHumanReview) {
      update.requires_human_review = true;
      update.human_review_reason =
        status === "mismatch"
          ? `Citation ${def.code_reference?.section ?? "?"} doesn't match the canonical FBC text — verify the section is correct.`
          : status === "not_found"
            ? `Cited FBC section ${def.code_reference?.section ?? "?"} was not found in the code library — verify or correct.`
            : `No FBC section parseable from this finding — add or correct the citation.`;
    }
    const { error: updErr } = await admin
      .from("deficiencies_v2")
      .update(update)
      .eq("id", def.id);
    if (updErr) console.error("[ground_citations] update failed", def.id, updErr);
  }

  const cropResult = await attachEvidenceCrops(admin, planReviewId);

  return {
    examined: defs.length,
    verified: counts.verified,
    mismatch: counts.mismatch,
    not_found: counts.not_found,
    hallucinated: counts.hallucinated,
    crops_attached: cropResult.attached,
    crops_skipped: cropResult.skipped,
    crops_unresolved_sheets: cropResult.unresolved_sheets,
  };
}

// ---------- evidence crops ----------
//
// For each finding, set evidence_crop_url to the signed URL of the first
// sheet_ref's rendered page asset. Reviewers get a thumbnail preview and a
// one-click jump to the source page. Full-sheet image is intentionally used
// instead of bbox cropping — image processing in the edge worker is a larger
// lift, and the full sheet is still infinitely better than no image.
async function attachEvidenceCrops(
  admin: ReturnType<typeof createClient>,
  planReviewId: string,
): Promise<{ attached: number; skipped: number; unresolved_sheets: number }> {
  const { data: rows, error } = await admin
    .from("deficiencies_v2")
    .select("id, sheet_refs, evidence_crop_url, evidence_crop_meta")
    .eq("plan_review_id", planReviewId)
    .neq("status", "resolved")
    .neq("status", "waived");
  if (error) {
    console.error("[evidence_crops] read failed", error);
    return { attached: 0, skipped: 0, unresolved_sheets: 0 };
  }
  const findings = (rows ?? []) as Array<{
    id: string;
    sheet_refs: string[] | null;
    evidence_crop_url: string | null;
    evidence_crop_meta: Record<string, unknown> | null;
  }>;
  if (findings.length === 0) return { attached: 0, skipped: 0, unresolved_sheets: 0 };

  const { data: prRow, error: prErr } = await admin
    .from("plan_reviews")
    .select("checklist_state")
    .eq("id", planReviewId)
    .maybeSingle();
  if (prErr || !prRow) {
    console.error("[evidence_crops] plan_review read failed", prErr);
    return { attached: 0, skipped: findings.length, unresolved_sheets: 0 };
  }
  const checklist = (prRow.checklist_state ?? {}) as Record<string, unknown>;
  const rawMap = Array.isArray(checklist.last_sheet_map)
    ? (checklist.last_sheet_map as Array<{ sheet_ref?: string; page_index?: number }>)
    : [];

  // Strict + fuzzy lookup so "A101", "A-101", "A-0101", "A.101" all collapse.
  const sheetToPage = new Map<string, number>();
  const fuzzyToPage = new Map<string, number>();
  const fuzzy = (s: string) =>
    s.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^([A-Z]+)0+(\d)/, "$1$2");
  for (const m of rawMap) {
    if (typeof m.sheet_ref === "string" && typeof m.page_index === "number") {
      sheetToPage.set(m.sheet_ref.toUpperCase().trim(), m.page_index);
      fuzzyToPage.set(fuzzy(m.sheet_ref), m.page_index);
    }
  }
  if (sheetToPage.size === 0) {
    return { attached: 0, skipped: findings.length, unresolved_sheets: findings.length };
  }

  const resolveSheet = (raw: string | null | undefined): { sheet: string; page: number } | null => {
    if (!raw) return null;
    const upper = raw.toUpperCase().trim();
    const exact = sheetToPage.get(upper);
    if (exact != null) return { sheet: upper, page: exact };
    const fuzzed = fuzzyToPage.get(fuzzy(upper));
    if (fuzzed != null) return { sheet: upper, page: fuzzed };
    return null;
  };

  const signed = await signedSheetUrls(admin, planReviewId);
  const pageUrlByIndex = new Map<number, string>();
  signed.forEach((s, i) => pageUrlByIndex.set(i, s.signed_url));

  const { data: assetRows } = await admin
    .from("plan_review_page_assets")
    .select("page_index, cached_until")
    .eq("plan_review_id", planReviewId)
    .eq("status", "ready");
  const expiryByIndex = new Map<number, string>();
  for (const a of (assetRows ?? []) as Array<{ page_index: number; cached_until: string | null }>) {
    if (a.cached_until) expiryByIndex.set(a.page_index, a.cached_until);
  }

  let attached = 0;
  let skipped = 0;
  let unresolved = 0;
  for (const f of findings) {
    const meta = (f.evidence_crop_meta ?? {}) as Record<string, unknown>;
    const hasPageIndex = typeof meta.page_index === "number";
    const isPinned = meta.pinned === true;

    if (isPinned) {
      skipped++;
      continue;
    }
    if (f.evidence_crop_url && hasPageIndex) {
      skipped++;
      continue;
    }

    const refs = f.sheet_refs ?? [];
    let resolved: { sheet: string; page: number } | null = null;
    for (const r of refs) {
      resolved = resolveSheet(r);
      if (resolved) break;
    }
    if (!resolved) {
      unresolved++;
      const { error: updErr } = await admin
        .from("deficiencies_v2")
        .update({
          evidence_crop_meta: {
            ...meta,
            unresolved_sheet: true,
            attempted_refs: refs,
            attempted_at: new Date().toISOString(),
          },
        })
        .eq("id", f.id);
      if (updErr) console.error("[evidence_crops] unresolved meta update", f.id, updErr);
      continue;
    }
    const url = pageUrlByIndex.get(resolved.page);
    if (!url) {
      skipped++;
      continue;
    }
    const { error: updErr } = await admin
      .from("deficiencies_v2")
      .update({
        evidence_crop_url: url,
        evidence_crop_meta: {
          ...meta,
          sheet_ref: resolved.sheet,
          page_index: resolved.page,
          signed_until: expiryByIndex.get(resolved.page) ?? null,
          source: "auto",
          unresolved_sheet: false,
          attached_at: new Date().toISOString(),
        },
      })
      .eq("id", f.id);
    if (updErr) {
      console.error("[evidence_crops] update failed", f.id, updErr);
      skipped++;
    } else {
      attached++;
    }
  }
  return { attached, skipped, unresolved_sheets: unresolved };
}
