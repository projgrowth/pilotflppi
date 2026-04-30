
# Pre-publish reliability fixes

After auditing recent runs, the database tells a sharp story: **almost every recent review ends in `needs_human_review` with 100% unverified findings** — including ones from today (8/8, 7/7, 18/18, 12/12 unverified). The letter-readiness gate then blocks delivery, so the pipeline effectively never finishes for the user. There are also a few smaller potholes worth filling before publishing.

## What's actually breaking

### 1. Verifier never runs in `core` mode (CRITICAL — root cause of "needs_human_review" epidemic)

`CORE_STAGES` in `supabase/functions/run-review-pipeline/_shared/types.ts` is:

```
upload → prepare_pages → sheet_map → submittal_check → dna_extract →
discipline_review → critic → dedupe → ground_citations → challenger → complete
```

**`verify` is only in `DEEP_STAGES`.** Default runs are `core`, so the verifier is skipped, every finding stays `verification_status='unverified'`, and the readiness gate produces `"Verifier stalled — N of N findings never reached a verdict"`. Result: even a clean run looks broken.

Fix: insert `verify` into CORE_STAGES between `ground_citations` and `challenger` (challenger is the adversarial pass and benefits from verifier verdicts being present). Remove it from DEEP_STAGES so it isn't double-run on `mode=full`.

### 2. `submittal_check` is missing from the stuck-recovery allowlist

`pipeline_error_log` shows: `Stuck at unknown stage 'submittal_check' for 19 min — cannot auto-recover.` The reconciler's `SERVER_RECOVERABLE_STAGES` set in `supabase/functions/reconcile-stuck-reviews/index.ts` lists every stage **except** `submittal_check` and `challenger`. Both of these run server-side and should be retryable.

Fix: add `"submittal_check"` and `"challenger"` to `SERVER_RECOVERABLE_STAGES`.

### 3. Reviews stuck in browser stages can never recover on their own

For `upload` and `prepare_pages` the reconciler flips status to `needs_user_action` and waits for the user to re-open the project. But the `StuckRecoveryBanner` only shows the "Prepare pages now" CTA when `needsPreparation` is true based on missing page assets — it does not key off `ai_check_status='needs_user_action'`. So the user opens the project, sees a vague warning banner with no button, and bounces.

Fix: when `ai_check_status='needs_user_action'` AND the stage was `prepare_pages`, surface the existing "Prepare pages now" button (it already calls `useUploadAndPrepare`'s rasterizer). When the stage was `upload`, surface a "Re-upload files" CTA that scrolls to / opens the upload dialog.

### 4. "Re-run verifier" button does nothing useful in core-mode runs

Today the banner offers `startPipeline(planReviewId, "core", "verify")`, but `verify` isn't in `CORE_STAGES`. After fix #1 it will be, so the button starts working — no code change beyond #1.

## Smaller hygiene items worth shipping at the same time

### 5. Hallucinated-citation auto-hide is missing on some runs

Two recent reviews show `has_hallucinated_citations: true` with `with_evidence_crop_pct: 0`. These are findings the AI invented. They currently still count toward "12 of 12 unverified" in the banner. The `liveBreakdown` in `StuckRecoveryBanner.tsx` already filters by `citation_status !== 'hallucinated'` for the unverified count, but the **denominator** (`total`) still includes them. Quick fix: also exclude hallucinated from `total` and add a separate "N hidden as hallucinated" line.

### 6. `cost_metric` errors are noisy (≈300 in 14 days) but cosmetic

These come from `_shared/cost.ts` failing to record per-stage cost. They don't affect output but they crowd `pipeline_error_log` and make real failures harder to spot. Wrap the cost insert in a try/catch and downgrade to a single `console.warn` — no DB write — when it fails.

### 7. ExternalDataPanel error UX

`fetch-fema-flood` and `fetch-asce-hazard` both return JSON errors (rate limit, no coverage, geocode miss) but the panel currently shows a generic spinner→empty state. Add a small inline error chip with a retry button so reviewers know whether to trust "no flood zone" vs. "we couldn't reach FEMA".

## Out of scope (already healthy)

- DNA extract, sheet_map, discipline_review chunking (resumes correctly via heartbeat path).
- Auto-recovery success banner.
- Beta feature flag plumbing (just shipped).

## Files to change

- `supabase/functions/run-review-pipeline/_shared/types.ts` — move `verify` into CORE_STAGES, drop from DEEP_STAGES.
- `supabase/functions/reconcile-stuck-reviews/index.ts` — add `submittal_check`, `challenger` to recoverable set.
- `src/components/plan-review/StuckRecoveryBanner.tsx` — wire `needs_user_action` to existing `Prepare pages now` / new `Re-upload files` CTAs; exclude hallucinated from `total`.
- `src/pages/PlanReviewDetail.tsx` — pass `recoveredFromStage` and an `onReupload` handler to the banner.
- `supabase/functions/run-review-pipeline/_shared/cost.ts` — silence cost-metric insert failures.
- `src/components/plan-review/ExternalDataPanel.tsx` — inline error + retry.

## Verification after the fix

1. Trigger a fresh review on a clean PDF → confirm `verify` stage appears in `review_pipeline_status` and `verification_status` flips to `verified`/`modified`/`needs_human` for each finding (no more 100% unverified).
2. Confirm `ai_check_status` lands on `complete` (not `needs_human_review`) when verifier verdicts pass thresholds.
3. Force a stuck `submittal_check` (cancel mid-run) → wait 15 min → reconciler retries it instead of failing.
4. Open a review with `ai_check_status='needs_user_action'` and stage `prepare_pages` → "Prepare pages now" button appears and runs the in-browser rasterizer.
5. Check `pipeline_error_log` 24 h later — `cost_metric` rows should be near zero.

Approve and I'll apply these in one pass.
