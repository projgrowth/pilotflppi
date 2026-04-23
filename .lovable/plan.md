

# Plan-Review precision & reliability — round 4

I traced the live code + the Porsche review's actual run. Here's the truth and what to do about it.

## What the data says

```text
Porsche review 85919248
  pages rasterized      : 78/78  ✅
  sheets mapped         : 78 (74 Architectural, 4 General)  ✅
  Architectural reviewed: 40/74  ❌  (capped, MAX_SHEETS_PER_DISCIPLINE = 40)
  total findings        : 20    (all Architectural)
  ai_check_status       : complete
```

The 78-page banner and rasterizer are fixed — the *cap* is what's still chopping the review. And several "completed" items from prior turns never landed in code. Here are the precise gaps and fixes.

## 1. Lift `MAX_SHEETS_PER_DISCIPLINE` and make it adaptive

**Bug**: `index.ts:1188` still hard-caps a discipline at 40 sheets. Porsche has 74 architectural sheets; 34 were never seen by the AI. The chunking already keeps payloads small (8 sheets/call) — there's no model-size reason to cap at 40.

**Fix**:
- Raise the ceiling to `MAX_SHEETS_PER_DISCIPLINE = 200` (covers any realistic plan set; 25 chunks × 8 = bounded).
- Add a per-chunk timeout safety: if a single discipline exceeds 18 chunks (~150 sheets), break and write a `capped_at` note. Real protection lives in time, not sheet count.
- Add structured per-chunk logging to `pipeline_error_log` (`stage: 'discipline_review'`, `error_class: 'chunk_summary'`) so we can see "chunk 1 of 10 → 3 findings" in dashboard error tab and prove every chunk actually ran.

## 2. Adversarial DNA gate — actually wire the previous turn's claim

**Bug**: A prior turn claimed it switched to a hard required-fields gate. The current code (`evaluateDnaHealth`, lines 1019-1075) still uses the old 50%-completeness rule and only blocks on `county`. Occupancy or FBC edition can be null and the pipeline runs anyway, producing wrong code citations.

**Fix** (real this time):
```ts
const HARD_REQUIRED = ["county", "occupancy_classification", "fbc_edition"];
const hardMissing = HARD_REQUIRED.filter((f) => criticalMissing.includes(f));
if (hardMissing.length > 0) {
  blocking = true;
  block_reason = `Required DNA fields missing: ${hardMissing.join(", ")}.`;
}
```
Keep the 50% rule as a soft warning surfaced in the dashboard, not a blocker. Use-type ("residential" vs "commercial") gets the same hard-required treatment because it routes the entire FBC vs FBCR prompt path.

## 3. Tighter citation grounding (also previously claimed, never landed)

**Bug**: `citationOverlapScore` threshold at line 2892 is still `>= 0.18`. That's so loose a finding only needs to share three common words with the canonical text to "verify". Raises false confidence on every code-anchored finding.

**Fix**:
- Threshold → `>= 0.30`.
- Require that the AI text literally mentions the section number (`finding+required_action.toLowerCase().includes(hit.section.toLowerCase())`) before marking `verified` — otherwise mark `mismatch`.
- For `mismatch`, set `requires_human_review = true` so reviewers see citations the AI quoted but didn't substantiate.

## 4. Prompt versioning — finish the loop

**State**: `prompt_versions` table exists, `deficiencies_v2.prompt_version_id` column + FK exist, but no insert path stamps it. Without this, every AI tweak is invisible to QA.

**Fix**:
- One-time seed: insert the current discipline-expert prompts as `prompt_versions` rows (one per discipline, status `active`).
- `runDisciplineChecks`: at start, fetch `prompt_versions.id WHERE name = '<discipline>' AND status = 'active'` (cache in memory per worker).
- Stamp `prompt_version_id` on each `deficiencies_v2` insert.
- Surface the active version in the dashboard's project-DNA viewer so reviewers know which prompt round produced which finding.

## 5. Idempotent finding inserts (race protection)

**Bug**: `runDisciplineChecks` computes `def_number` from a live `count()` then inserts. If two workers race (chunk retry + scheduled retry, common today because `NON_FATAL_RETRY_STAGES` retries 3×), we get duplicate `def_number`s. There's no unique constraint to stop it.

**Fix**:
- Migration: `CREATE UNIQUE INDEX deficiencies_v2_review_def_uniq ON deficiencies_v2 (plan_review_id, def_number);`
- In the insert path, switch to `.upsert(rows, { onConflict: "plan_review_id,def_number", ignoreDuplicates: true })`.
- For the ID seed, switch from `count()` to `MAX(def_number)`-style next-id using a SELECT, scoped per `(plan_review_id, discipline)`, with a 3-attempt jitter retry on conflict.

## 6. `stageVerify` page-image cap is still hard-coded to 5

**Bug**: line 2348 — `Array.from(pageSet).slice(0, 5)`. Multi-sheet findings cited on 4-6 sheets get truncated. The previously claimed "derive from page_indices" change never shipped.

**Fix**: replace `slice(0, 5)` with `slice(0, Math.min(8, pageSet.size))`. The 8-image ceiling matches `DISCIPLINE_BATCH` payload sizing; verification quality jumps for cross-sheet findings.

## 7. Cross-sheet consistency — diversify selection

**Bug**: `runCrossSheetConsistency` picks 8 sheets sorted by prefix `[A,S,M,P,E,F,L,G]`, so on Porsche (74 A's, 0 S/M/E) it sends 8 architectural sheets and never crosses disciplines. The whole point of cross-check is multi-discipline. Picks must round-robin by discipline.

**Fix**:
```ts
// Group by discipline, then take up to 2 per discipline in priority order.
const PRIORITY = ["A","S","M","P","E","F","L","G"];
const buckets = new Map<string, typeof allSheets>();
for (const s of allSheets) {
  const k = s.sheet_ref.trim().toUpperCase()[0] ?? "Z";
  if (!buckets.has(k)) buckets.set(k, []);
  buckets.get(k)!.push(s);
}
const selected: typeof allSheets = [];
for (let pass = 0; pass < 4 && selected.length < 8; pass++) {
  for (const k of PRIORITY) {
    if (selected.length >= 8) break;
    const b = buckets.get(k);
    if (b && b[pass]) selected.push(b[pass]);
  }
}
```
Result: 1 sheet per discipline first, then 2nd pass, etc. — guarantees real cross-discipline coverage when multiple disciplines exist, falls back gracefully on single-discipline sets.

## 8. Per-chunk cancellation check

**Bug**: cancellation is checked only between *stages*, not between *chunks within `discipline_review`*. A 10-chunk Architectural run keeps spending tokens for ~5 minutes after the user clicks Cancel.

**Fix**: pass `isCancelled` into `stageDisciplineReview` (already in scope above) and check at the top of each `for (let cs = ...; cs += DISCIPLINE_BATCH)` iteration. On true: write a partial `review_coverage` row with current counts, throw a tagged `cancelled` error that the dispatcher already handles cleanly.

## 9. Cache signed URLs in the DB

**Bug**: every stage that needs page images calls `signedSheetUrls()` which signs all N URLs. The columns `cached_signed_url` and `cached_until` already exist on `plan_review_page_assets` (from a prior migration) but are never written or read. On a 78-page Porsche run, that's ~5 stages × 78 = 390 signed-URL calls when one set would do.

**Fix**: in `readSignedManifest`, batch-update `cached_signed_url` + `cached_until = now() + 6h` when signing. On read: prefer cached URLs that are still valid; only re-sign expired rows.

## 10. Surface partial-rasterize failures into the pipeline error log

**Bug**: `rasterizeAndUploadPagesResilient` returns `failures[]` but `uploadPlanReviewFiles` only puts them in a toast. Once the user dismisses the toast there's no record. If 1 of 78 pages quietly failed, that finding can't be verified later because `signedUrls[idx]` is undefined.

**Fix**:
- Persist failures: write each `failures[]` entry as a `pipeline_error_log` row (`stage: 'upload'`, `error_class: 'rasterize_partial'`, metadata = `{file, page_index, reason}`).
- On `prepare_pages`, if `page_assets count < expected_total` (`expected_total` = sum of `getPDFPageCount` per file, persisted into `plan_reviews.ai_run_progress.expected_pages` at upload time), throw `NEEDS_BROWSER_RASTERIZATION` like today — but with the missing page indices in the error message so the re-prepare flow only renders the gaps.

## 11. Dead code sweep enabled by these changes

```text
DELETE
  src/lib/pdf-utils.ts → renderPDFPagesForVision (10-page cap, no callers)
  index.ts → references to removed MAX_DISCIPLINE_PAGES (already gone)
  usePdfPageRender.ts → pageCapInfo property (always null, kept for "backward compat")
EDIT
  Drop SHEET_MAP_SCHEMA enum value "Other" — sheet_map already coerces to "General",
  having both confuses the model and produces inconsistent labels.
```

---

## Files changed

```text
EDIT
  supabase/functions/run-review-pipeline/index.ts
    • MAX_SHEETS_PER_DISCIPLINE 40 → 200; per-chunk cancellation check
    • evaluateDnaHealth: hard-block on county + occupancy + fbc_edition
    • stageGroundCitations: threshold 0.18 → 0.30 + section-mention requirement
    • runDisciplineChecks: stamp prompt_version_id; idempotent upsert
    • stageVerify: page cap 5 → 8 (derived from pageSet.size)
    • runCrossSheetConsistency: round-robin discipline selection
    • readSignedManifest: persist + reuse cached_signed_url/cached_until
  src/lib/plan-review-upload.ts
    • Persist rasterize failures to pipeline_error_log
    • Write expected_pages into ai_run_progress at upload time
  src/hooks/plan-review/usePdfPageRender.ts
    • Drop pageCapInfo (always null)

CREATE
  supabase/migrations/<ts>_def_unique_and_prompts.sql
    • UNIQUE INDEX deficiencies_v2(plan_review_id, def_number)
    • Seed prompt_versions rows for the 9 disciplines + cross-sheet + verify
```

## Verification after edits

- Re-run Porsche → `review_coverage.by_discipline.Architectural = {reviewed: 74, total: 74}`, capped_at = null.
- Issue a duplicate `def_number` insert from a forced retry → upsert no-ops, no row dup.
- Open a finding view → `prompt_version_id` populated, dashboard shows the active prompt name.
- Force a missing-occupancy DNA → pipeline halts at `dna_extract` with clear `Required DNA fields missing` message instead of silently producing low-quality findings.
- Click Cancel mid-discipline_review → next chunk doesn't fire, partial coverage row written.
- Cross-sheet check on a multi-discipline set → log shows sheet selection includes A + S + M + E (not 8 A's).

No additional UI changes; the existing CoverageChip already reads from `review_coverage`. No edge-function contract changes.

