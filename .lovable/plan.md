

# Items #7, #8, #10 — Auto-recovery, gap re-rasterize, round-2 diff

Three independent reliability/efficiency wins. None of them affect AI prompts or the dashboard layout.

## 1. Auto-recover stuck reviews (#7)

**Problem**: 7 reviews are sitting at `ai_check_status = 'pending'` with the oldest from April 16 — no error, no progress, just abandoned. Today these block the user from re-running the pipeline because the dispatcher won't restart a non-failed review.

**Fix**:
- New edge function **`reconcile-stuck-reviews`** (cron-triggered, every 5 min):
  - Find reviews where `ai_check_status IN ('pending','running')` and `updated_at < now() - interval '15 minutes'`.
  - For each: log a `pipeline_error_log` row (`stage='dispatch'`, `error_class='stuck_no_progress'`, metadata = last known stage + minutes idle).
  - If `retry_count < 1` (read from the new metadata): flip `ai_check_status='pending'`, clear `cancelled_at` from `ai_run_progress`, and call `startPipeline()` to retry once.
  - If already retried once: flip to `ai_check_status='failed'` with a clear reason in `ai_run_progress.failure_reason`. The dashboard already surfaces failed reviews.
- Schedule it with `pg_cron` + `pg_net` (extensions exist already per project setup).
- Add a small `<StuckRecoveryBanner />` on `PlanReviewDetail` that appears when `ai_run_progress.auto_recovered_at` is set, telling the user "we noticed this stalled and resumed it".

## 2. Gap-only re-rasterize (#8)

**Problem**: `reprepareInBrowser` today **deletes the entire `plan_review_page_assets` manifest** and re-renders all pages, even if only 1 of 78 actually failed. On a 78-page set that's 5 minutes of re-work for a 4-second problem.

**Fix**: Add a **gap-detection mode** to `reprepareInBrowser`:
1. Read `plan_reviews.ai_run_progress.expected_pages` (already populated by upload) and the current `plan_review_page_assets` rows.
2. Compute `missingIndices = expectedRange \ existingPageIndices`.
3. If `missingIndices.length === 0`: no-op, just kick the pipeline. If all pages missing: full re-rasterize (today's behavior).
4. If partial: rasterize **only** the missing page indices using a new `rasterizePagesByIndex(file, indices, dpi)` helper added to `pdf-utils.ts` (uses pdf.js `getPage(i)` for each gap, doesn't render the rest).
5. **Insert** (not delete-then-insert) the new manifest rows. The unique index from the last migration on `(plan_review_id, page_index)` (we'll add it) prevents collisions.

UI:
- New `ReviewHealthStrip` chip "**77/78 pages ready**" with click → "Repair missing page" runs gap-only re-rasterize. Replaces the current toast-only error path.
- Toast on success: "Repaired 1 of 78 pages" instead of "Re-prepared 78 pages".

Migration:
- `CREATE UNIQUE INDEX plan_review_page_assets_review_page_uniq ON plan_review_page_assets (plan_review_id, page_index);`
- Dedupe any existing collisions first (none expected, but safe).

## 3. Round-2 diff intelligence (#10)

**Problem**: When a resubmittal lands today (`round` increments), the pipeline runs from scratch on every page. We already have `previous_findings` populated and a `useRoundDiff` hook that detects unchanged sheets — but the **pipeline doesn't use that signal** to skip work.

**Fix** — three coordinated changes in `run-review-pipeline/index.ts`:

1. **New helper `computeChangedSheets(planReviewId, round)`** runs after `sheet_map`:
   - Loads previous round's `sheet_map` snapshot from `plan_reviews.checklist_state.last_sheet_map` (we'll add this write at end of every successful run).
   - Compares each new sheet's `sheet_ref + page_count + sha256(rasterized_jpeg)` against the prior snapshot.
   - Returns `{unchanged: SheetRow[], changed: SheetRow[]}`.

2. **`stageDisciplineReview` on round ≥ 2**: only sends `changed` sheets to the AI. For each `unchanged` sheet, replay any prior round's findings against it as **carryover deficiencies** (status `open`, marked `metadata.carryover_from_round = N-1`). Reviewers see them in a separate "Carried over" filter chip.

3. **Letter generation**: split into "New this round" (changed sheets) + "Still open from round N-1" (carryover). Reviewers focus only on the new section.

DB:
- Add `metadata jsonb` column on `deficiencies_v2` (already exists? need to verify; if not, migration adds it).
- Add `last_sheet_map jsonb` to `plan_reviews.checklist_state` write at end of `cross_check` stage. No schema change needed — it's part of existing JSONB.

UI:
- `useRoundDiff` already exists; new `<RoundCarryoverPanel />` lists the carried-over findings on the workspace right panel as a collapsible group. New `FindingStatusFilter` chip "Carryover".

## Files changed

```text
CREATE
  supabase/functions/reconcile-stuck-reviews/index.ts
  src/components/plan-review/StuckRecoveryBanner.tsx
  src/components/plan-review/RoundCarryoverPanel.tsx
  supabase/migrations/<ts>_page_asset_uniq_and_recovery.sql
    • UNIQUE INDEX plan_review_page_assets_review_page_uniq
    • pg_cron schedule for reconcile-stuck-reviews (every 5 min)

EDIT
  src/lib/reprepare-in-browser.ts
    • Gap-detection mode: compute missing indices, render only those
    • Insert (not delete) when partial; full replace only when 0 existing
  src/lib/pdf-utils.ts
    • New rasterizePagesByIndex(file, indices, dpi) helper
  src/components/review-dashboard/ReviewHealthStrip.tsx
    • New "X/Y pages ready" chip → click triggers gap repair
  supabase/functions/run-review-pipeline/index.ts
    • computeChangedSheets() helper
    • stageDisciplineReview: skip unchanged sheets on round≥2, carryover prior findings
    • End-of-run: write last_sheet_map into checklist_state
    • Letter draft section split: New / Carried over
  src/pages/PlanReviewDetail.tsx
    • Mount RoundCarryoverPanel
    • Mount StuckRecoveryBanner
  src/hooks/plan-review/useFindingFilters.ts
    • New "carryover" chip filter using metadata.carryover_from_round
```

## Verification

- Force-stale a `pending` review by touching `updated_at` 20 min back → cron run flips it to retry, second run flips to `failed` with `stuck_no_progress` reason.
- Delete 1 page asset row from a completed review → health strip shows "77/78 pages ready", click → repair adds only that page (network shows 1 JPEG upload, not 78).
- Submit a round-2 resubmittal where 2 of 74 architectural sheets changed → edge logs show `discipline_review` ran on 2 sheets, 72 carryover findings inserted, letter draft has separate "Carried over" section.
- Existing reviews continue to work: round 1 is unaffected; reviews without `expected_pages` fall back to today's full-replace behavior.

No prompt changes, no auth changes, no breaking dashboard changes. Three additive features that compose cleanly with everything shipped in rounds 1-4.

