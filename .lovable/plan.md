

# Why the Porsche review still shows 10 pages — and the fix

## Root cause: the "lift the 10-page cap" implementation never actually landed

I just confirmed against the live code and the database. Three caps are still in place, **none** of the changes from the previous turn shipped:

| Layer | Where | Status |
|---|---|---|
| Browser viewer cap | `usePdfPageRender.ts` line 47, 52 — `Math.min(total, 10)` and `renderPDFPagesToImages(file, 10, 150)` | ❌ Still capped at 10 |
| Display banner | `PlanReviewDetail.tsx` line 630 — "Limited review — first 10 of 78" | ❌ Still rendering |
| Server AI cap | `run-review-pipeline/index.ts` line 1191 — `MAX_DISCIPLINE_PAGES = 10` | ❌ Still capped at 10 |
| Vision rasterizer | `rasterizeAndUploadVisionPages` referenced in plan | ❌ Function does not exist in `pdf-utils.ts` |
| `review_coverage` table | Migration referenced in plan | ❌ No table created |
| `CoverageChip` | Component referenced in plan | ❌ Not in repo |

On top of that, the database tells me a fourth, separate problem on this specific review:

```text
plan_review eb8df5a0-… (Porsche)
  ai_check_status      : pending  (cancelled)
  file_urls count      : 1        (78-page PDF)
  page_assets rows     : 1        ← rasterizer made only 1 of 78 page JPEGs
  deficiencies_v2 rows : 0
  review_coverage row  : missing
```

`rasterizeAndUploadPages` quietly produced 1 image instead of 78. Even if we lift every cap, the AI has nothing to read because the per-page JPEGs the manifest points to don't exist. The browser viewer shows you 10 because 10 is the cap *and* it's rendering directly from the original PDF — independent of the broken manifest.

## The fix, in three concrete pieces

### 1. Actually remove the caps (the work the prior turn skipped)

```text
src/hooks/plan-review/usePdfPageRender.ts
  • Drop `Math.min(total, 10)` (line 47)
  • Drop the `, 10, 150)` cap arg (line 52) → call renderPDFPagesToImages(file, total, 150)
  • Eager-render first 10, queue the rest via requestIdleCallback to keep UI responsive
  • Replace pageCapInfo state with phase: 'eager' | 'background' | 'done'

src/pages/PlanReviewDetail.tsx
  • Delete the "Limited review" banner block (lines 629-637)
  • Read coverage from new review_coverage row instead

supabase/functions/run-review-pipeline/index.ts
  • Delete `MAX_DISCIPLINE_PAGES = 10` (line 1191)
  • Replace the `.slice(0, 10)` with chunked batches of 8 + general-sheet seed
  • Loop runDisciplineChecks per chunk, sum findings, dedupe by def_number
  • Add safety ceiling MAX_SHEETS_PER_DISCIPLINE = 40

src/lib/pdf-utils.ts
  • renderPDFPagesToImages: change default cap from 10 → totalPages so callers
    that don't pass a value get every page
```

### 2. Repair the rasterizer so all 78 pages actually upload

`rasterizeAndUploadPages` is producing 1 row instead of 78 on the Porsche set. Two likely causes — fix both defensively:

- **Per-page upload failure being swallowed**: each page JPEG upload error currently aborts silently with `continue`. Switch to `Promise.allSettled` per page, log each failure to `pipeline_error_log`, and surface "rasterized X of Y" in the upload toast so the user sees when only 1 of 78 pages made it.
- **Browser memory pressure on big PDFs**: 78 pages × 150 DPI rendered all at once will OOM mid-PDF in some browsers. Render in batches of 4, releasing canvas memory between batches via explicit `canvas.width = 0; canvas.height = 0;` cleanup. This is the same chunking pattern `extractPagesTextItems` already uses.

Add a one-time **manifest reconciliation** call at the start of `prepare_pages`: if `page_assets count < pdf.numPages` for any file, re-rasterize the missing indices in the browser before the AI stage runs. This recovers Porsche-style reviews where the original upload partially failed without making the user re-upload.

### 3. Persist coverage truthfully

```sql
-- new migration
CREATE TABLE public.review_coverage (
  plan_review_id uuid PRIMARY KEY REFERENCES plan_reviews(id) ON DELETE CASCADE,
  firm_id uuid,
  sheets_total int NOT NULL,
  sheets_reviewed int NOT NULL,
  by_discipline jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- shape: { "Architectural": {reviewed: 74, total: 74}, "Structural": {reviewed: 0, total: 0} }
  capped_at int,  -- if any discipline hit MAX_SHEETS_PER_DISCIPLINE
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.review_coverage ENABLE ROW LEVEL SECURITY;
-- RLS: matches plan_reviews firm scoping (same policies pattern as deficiencies_v2)
```

`stageDisciplineReview` writes one row at the end of each run. The workspace reads it instead of the cosmetic `pageCapInfo`. New `<CoverageChip />` in `ReviewHealthStrip.tsx` shows `78/78` (or `40/74` if a giant set was bounded) with a per-discipline popover.

---

## Files changed

```text
EDIT
  src/hooks/plan-review/usePdfPageRender.ts        — remove 10-page cap, add eager+background phases
  src/lib/pdf-utils.ts                             — default cap → totalPages, batch+release for big PDFs
  src/lib/plan-review-upload.ts                    — Promise.allSettled per-page, surface partial-success
  src/pages/PlanReviewDetail.tsx                   — drop pageCapInfo banner, read review_coverage
  src/components/review-dashboard/ReviewHealthStrip.tsx  — Coverage chip
  supabase/functions/run-review-pipeline/index.ts
    • runDisciplineChecks: chunk by DISCIPLINE_BATCH = 8, dedupe findings,
      respect MAX_SHEETS_PER_DISCIPLINE = 40
    • stagePreparePages: if page_assets < pdf.numPages, re-rasterize gaps
    • stageDisciplineReview: write review_coverage row at end
    • signedSheetUrls: optional pageIndices filter (sign only what stage needs)

CREATE
  src/components/review-dashboard/CoverageChip.tsx
  supabase/migrations/<ts>_review_coverage.sql

DELETE
  • The "Limited review" banner JSX in PlanReviewDetail
  • pageCapInfo state in usePdfPageRender
```

## Verification on Porsche after these edits

- Workspace viewer shows all 78 pages (first 10 instant, rest stream in via idle callback).
- `plan_review_page_assets` row count = 78 for the Porsche review (re-rasterize fills the 77 gap on next pipeline kick).
- Rerun the pipeline → `review_coverage.by_discipline.Architectural = {reviewed: 74, total: 74}`.
- Edge logs show ~9 chunked `discipline_review` calls for Architectural, not 1.
- "Limited review" banner gone; replaced by `78/78 sheets reviewed` chip in the health strip.
- Toast on partial upload now reads e.g. "Rasterized 77 of 78 pages — 1 failed" instead of silent loss.

No keyboard or other UX regressions. The dashboard changes are purely additive (new chip in existing strip).

