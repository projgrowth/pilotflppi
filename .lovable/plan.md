

# Round 7 — Highest-leverage improvements (UX + reliability)

After Rounds 1–6 the backend is stable: 0 stuck pendings, no active failures from the new code path, recovery cron working. The remaining wins are **upstream of the pipeline** (so the bad runs never start) and **on the user side** (so a single misclick doesn't burn an analysis).

I'm proposing 5 fixes, ranked by impact. Pick any subset.

## 1. Block uploads that are guaranteed to fail (highest leverage)

**Problem:** Every "stuck at upload/prepare_pages" failure in the database started life as an upload that never completed in the browser. The user closes the tab while pdf.js is still rasterizing → server has the PDF, has no page assets, never recovers. Today we discover this 20 minutes later via cron.

**Fix:**
- Show a **persistent in-page progress bar** while `rasterizeAndUploadPagesResilient` runs (currently it's only a toast that disappears).
- Add a `beforeunload` warning: "Pages are still being prepared. Closing now will require you to re-open the project to finish." Only attached while `pageAssetRows.length < totalExpectedPages`.
- After upload, if rasterization succeeded for <80% of expected pages, **don't start the pipeline** — show "Prepare pages first" with a one-click retry. A pipeline run on a partial manifest is the silent-failure precursor.
- File: `src/lib/plan-review-upload.ts` + a new `<UploadProgressBar>` component mounted in `PlanViewerPanel`.

## 2. Confirm dialog on Re-Analyze when findings already exist

**Problem:** The mobile crash is fixed, but a misclick on "Re-Analyze" still discards findings and burns ~$0.30 of model time. The button looks identical whether there are 0 findings or 47.

**Fix:**
- If `findings.length > 0`, intercept `onRunAICheck` with the existing `useConfirm` dialog: *"Re-analyze 47 findings? This will replace current results and take 2-4 minutes."*
- If `findings.length === 0`, run immediately (current behavior).
- File: `src/pages/PlanReviewDetail.tsx` (`runAICheck` function).

## 3. "Prepare pages" recovery banner is buried — promote it

**Problem:** `StuckRecoveryBanner` only renders for `needs_user_action` / `needs_human_review` / `auto_recovered_at`. The much more common case — a stale review the user navigates back to where `pre_rasterized=false` and the pipeline never ran — has no banner. They just see a "Run AI Check" button and click it, which fails server-side.

**Fix:**
- Add a 4th banner variant: **"This review hasn't been prepared yet"** — shows when `file_urls.length > 0 && page_assets.count === 0`. CTA: "Prepare pages now" → calls `reprepareInBrowser(id)`.
- Wired in the existing banner mount slot in `PlanReviewDetail.tsx`.
- File: `src/components/plan-review/StuckRecoveryBanner.tsx`.

## 4. Pipeline starts emitting structured cost telemetry

**Problem:** No visibility into per-stage cost. We don't know if `discipline_review` chunk retries are actually saving money, or which discipline burns most tokens. Round 6 added checkpoints but no measurement.

**Fix:**
- In `run-review-pipeline/index.ts`, after each Lovable AI call, write `{ stage, discipline, chunk, input_tokens, output_tokens, model, ms }` to `pipeline_error_log` with `error_class='cost_metric'`.
- Surface a small "Cost & timing" expander on the `PipelineActivity` page (already exists) reading the last 7d of `cost_metric` rows.
- 90-day retention already prunes these (added in Round 6).
- Files: `supabase/functions/run-review-pipeline/index.ts`, `src/pages/PipelineActivity.tsx`.

## 5. PlanReviewDetail.tsx is 893 lines — split the action handlers

**Problem:** Page is approaching maintenance cliff. Every recent fix touched the same monolith. The mobile crash, the auto-retry effect, the upload handler, the letter handler all live in one file.

**Fix (low risk, no behavior change):**
- Extract `useReviewActions(review, queryClient)` hook → owns `runAICheck`, `handlePipelineComplete`, `handleReprepareInBrowser`, `handleUploadFiles`. Returns the handlers + `aiRunning`/`aiCompleteFlash` state.
- Page becomes ~600 lines, all action logic testable in isolation.
- Files: new `src/hooks/plan-review/useReviewActions.ts` + diff in `src/pages/PlanReviewDetail.tsx`.

## Recommended order

Ship **1 + 2 + 3** together — they're the user-facing reliability story and prevent every silent-failure pattern still possible. **4** is a one-week-out diagnostic investment. **5** is housekeeping; do whenever convenient.

## Files changed (if you approve all 5)

```text
EDIT
  src/lib/plan-review-upload.ts                    — partial-rasterize gate, no-pipeline-on-partial
  src/pages/PlanReviewDetail.tsx                   — confirm on re-analyze, beforeunload guard, action extraction
  src/components/plan-review/StuckRecoveryBanner.tsx — 4th variant: "not prepared yet"
  supabase/functions/run-review-pipeline/index.ts  — cost_metric emission per AI call
  src/pages/PipelineActivity.tsx                   — cost & timing expander

CREATE
  src/components/plan-review/UploadProgressBar.tsx
  src/hooks/plan-review/useReviewActions.ts
```

Tell me which subset you want and I'll implement.

