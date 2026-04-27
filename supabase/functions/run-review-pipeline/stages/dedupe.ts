// Stage: dedupe.
// Cross-discipline deduplication. The discipline_review stage runs Architectural,
// Life Safety, Fire Protection, MEP, etc. in parallel and the same real-world
// issue (egress sign location, fire-rated wall, ADA clearance, sprinkler head
// spacing) often surfaces 2–3 times under different disciplines.
//
// Strategy:
//   1. Bucket live findings by normalized FBC section + overlapping sheet refs.
//   2. Within each bucket, group findings whose `finding` text overlaps >= 0.55
//      by token-set Jaccard. Single-finding groups are kept as-is.
//   3. Pick a winner per group:
//        - prefer non-overturned, non-superseded
//        - then the discipline that "owns" the cited code (Life Safety owns
//          1010.x egress, Fire Protection owns 903.x sprinklers, etc.)
//        - then highest confidence_score
//        - then most evidence quotes
//   4. Mark losers `verification_status = 'superseded'`, `status = 'waived'`,
//      and prepend a verification_notes line pointing at the winner.

import { createClient } from "../_shared/supabase.ts";

const STOP_WORDS = new Set([
  "the","a","an","and","or","of","to","in","on","at","is","are","be","with","for",
  "by","from","this","that","these","those","not","no","as","it","its","has","have",
  "must","shall","should","provide","provided","required","missing","per","cited",
  "see","sheet","sheets","plan","plans","drawings","drawing","detail","section",
  "code","fbc","florida","building","compliance","comply","review","reviewer",
]);

function tokenSet(text: string): Set<string> {
  return new Set(
    (text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOP_WORDS.has(t)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Normalize an FBC section ref so "1010.1.1", "FBC 1010.1.1", "1010.01.01" all collapse. */
function normSection(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .toLowerCase()
    .replace(/fbc|florida\s+building\s+code|building\s+code/g, "")
    .replace(/[^0-9.]/g, "")
    .replace(/\.0+(\d)/g, ".$1")
    .replace(/^\.+|\.+$/g, "")
    .trim();
}

/**
 * Discipline that "owns" a given FBC chapter/section. Used as a tie-breaker
 * when the same code is flagged by multiple disciplines.
 */
function ownerDiscipline(section: string): string | null {
  if (!section) return null;
  const chapter = parseInt(section.split(".")[0] || "0", 10);
  if (isNaN(chapter)) return null;
  if (chapter === 10) return "Life Safety";
  if (chapter === 11) return "Accessibility";
  if (chapter === 9) return "Fire Protection";
  if (chapter === 7) return "Architectural";
  if (chapter >= 16 && chapter <= 23) return "Structural";
  if (chapter >= 28 && chapter <= 30) return "MEP";
  return null;
}

interface DedupeWinnerPick {
  winner: string;
  losers: string[];
  reason: string;
}

interface DedupeRow {
  id: string;
  def_number: string;
  discipline: string;
  finding: string;
  sheet_refs: string[] | null;
  code_reference: { section?: string } | null;
  evidence: string[] | null;
  confidence_score: number | null;
  verification_status: string;
  status: string;
}

export async function stageDedupe(
  admin: ReturnType<typeof createClient>,
  planReviewId: string,
) {
  const { data: defsRaw, error } = await admin
    .from("deficiencies_v2")
    .select(
      "id, def_number, discipline, finding, sheet_refs, code_reference, evidence, confidence_score, verification_status, status",
    )
    .eq("plan_review_id", planReviewId)
    .neq("status", "resolved")
    .neq("status", "waived")
    .neq("verification_status", "overturned")
    .neq("verification_status", "superseded");
  if (error) throw error;

  const rows = (defsRaw ?? []) as DedupeRow[];
  if (rows.length < 2) {
    return { examined: rows.length, groups_merged: 0, findings_superseded: 0 };
  }

  const enriched = rows.map((d) => {
    const section = normSection(d.code_reference?.section);
    const sheets = new Set(
      (d.sheet_refs ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean),
    );
    const tokens = tokenSet(d.finding);
    return { row: d, section, sheets, tokens };
  });

  function bucketKey(e: { section: string; sheets: Set<string>; row: DedupeRow }): string | null {
    if (e.section) {
      const parts = e.section.split(".");
      const parent = parts.slice(0, Math.min(2, parts.length)).join(".");
      return `sec:${parent}`;
    }
    if (e.sheets.size > 0) {
      const firstSheet = [...e.sheets].sort()[0];
      return `sheet:${e.row.discipline}:${firstSheet}`;
    }
    return null;
  }
  const buckets = new Map<string, typeof enriched>();
  for (const e of enriched) {
    const key = bucketKey(e);
    if (!key) continue;
    const arr = buckets.get(key) ?? [];
    arr.push(e);
    buckets.set(key, arr);
  }

  const merges: DedupeWinnerPick[] = [];

  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;

    const visited = new Set<number>();
    for (let i = 0; i < bucket.length; i++) {
      if (visited.has(i)) continue;
      const group: number[] = [i];
      visited.add(i);
      for (let j = i + 1; j < bucket.length; j++) {
        if (visited.has(j)) continue;
        const a = bucket[i];
        const b = bucket[j];
        const sheetOverlap =
          a.sheets.size === 0 ||
          b.sheets.size === 0 ||
          [...a.sheets].some((s) => b.sheets.has(s));
        if (!sheetOverlap) continue;
        const threshold = a.row.discipline === b.row.discipline ? 0.45 : 0.35;
        if (jaccard(a.tokens, b.tokens) < threshold) continue;
        group.push(j);
        visited.add(j);
      }
      if (group.length < 2) continue;

      const candidates = group.map((idx) => bucket[idx]);
      const owner = ownerDiscipline(candidates[0].section);
      candidates.sort((a, b) => {
        const aOwn = owner && a.row.discipline === owner ? 1 : 0;
        const bOwn = owner && b.row.discipline === owner ? 1 : 0;
        if (aOwn !== bOwn) return bOwn - aOwn;
        const ac = a.row.confidence_score ?? 0;
        const bc = b.row.confidence_score ?? 0;
        if (ac !== bc) return bc - ac;
        const ae = (a.row.evidence ?? []).length;
        const be = (b.row.evidence ?? []).length;
        if (ae !== be) return be - ae;
        return a.row.def_number.localeCompare(b.row.def_number, undefined, {
          numeric: true,
        });
      });
      const winner = candidates[0];
      const losers = candidates.slice(1);
      merges.push({
        winner: winner.row.id,
        losers: losers.map((l) => l.row.id),
        reason: `Same issue (FBC ${winner.section || "—"}) flagged by ${candidates
          .map((c) => c.row.discipline)
          .filter((v, i, arr) => arr.indexOf(v) === i)
          .join(" + ")}; kept ${winner.row.def_number} (${winner.row.discipline}).`,
      });
    }
  }

  if (merges.length === 0) {
    return { examined: rows.length, groups_merged: 0, findings_superseded: 0 };
  }

  let supersededCount = 0;
  for (const m of merges) {
    const winnerRow = rows.find((r) => r.id === m.winner);
    const winnerLabel = winnerRow ? `${winnerRow.def_number} (${winnerRow.discipline})` : m.winner;
    for (const loserId of m.losers) {
      const loser = rows.find((r) => r.id === loserId);
      const priorNote = loser?.verification_status && loser.verification_status !== "unverified"
        ? ` Prior verification: ${loser.verification_status}.`
        : "";
      const note = `Merged into ${winnerLabel} during cross-discipline dedupe. ${m.reason}${priorNote}`;
      const { error: updErr } = await admin
        .from("deficiencies_v2")
        .update({
          verification_status: "superseded",
          verification_notes: note.slice(0, 1000),
          status: "waived",
          reviewer_disposition: "reject",
          reviewer_notes: `Auto-merged: duplicate of ${winnerLabel}. Flip status back to 'open' if this was wrong.`,
        })
        .eq("id", loserId);
      if (!updErr) supersededCount++;
    }
  }

  return {
    examined: rows.length,
    groups_merged: merges.length,
    findings_superseded: supersededCount,
    merges: merges.map((m) => {
      const winnerRow = rows.find((r) => r.id === m.winner);
      return {
        winner: m.winner,
        winner_def_number: winnerRow?.def_number ?? null,
        winner_discipline: winnerRow?.discipline ?? null,
        winner_confidence: winnerRow?.confidence_score ?? null,
        loser_ids: m.losers,
        loser_count: m.losers.length,
        reason: m.reason,
      };
    }),
  };
}
