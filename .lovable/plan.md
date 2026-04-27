# Next Precision/Reliability Improvements

The pipeline now produces canonical disciplines, citation grounding, and a quality score — but several pieces are computed and never used, and ~76% of existing findings have unverified or broken citation states. Three concrete improvements:

## 1. Surface the AI Run Quality Score

Right now `complete.ts` calculates a 0–100 quality score and writes it into the snapshot, but nothing in the UI ever reads it. Reviewers have no signal about how trustworthy a run is.

- Persist `quality_score` and its breakdown (citations / verification / evidence / hallucinations) onto `plan_reviews.ai_run_progress.quality` so it survives without a new column.
- Add a compact "AI Confidence" badge at the top of the plan review page showing the score, color-coded (green ≥80, amber 60–79, red <60), with a tooltip listing the four sub-scores.
- In the Findings panel header, show "X of Y citations verified" and "Z hallucinated" as small chips so the reviewer knows where to focus.

## 2. Real Evidence Crops + Bbox-Backed Pins

`evidence_crop_url` exists on every finding but is `NULL` for all 320 rows. Pins are still placed with the deterministic hash, which means they never actually point at the deficient detail.

- Add a new `evidence-crop` stage that runs after `verify`. For each finding, it asks Gemini 2.5 Pro Vision (already wired) to return a normalized bbox `{x, y, w, h, page_index}` for the cited sheet, then crops the page PNG via the existing `plan_review_page_assets` cache and uploads to the `documents` bucket.
- Store the bbox in `evidence_crop_meta` and the cropped PNG path in `evidence_crop_url`.
- Update `deficiency-adapter.ts` to prefer the real bbox over the deterministic hash when present, falling back to the hash only when the crop step failed.
- Show the crop thumbnail inside each finding row in `FindingsListPanel` so the reviewer can verify without opening the PDF viewer.

## 3. Repair Existing Findings

The historical data has 170 `unverified` citations, 47 `not_found`, and 19 `hallucinated` — these will never improve unless reprocessed.

- Add an admin-only "Re-ground citations" button on the plan review page that re-runs the `ground-citations` and `verify` stages for the current review without redoing the expensive vision pass.
- Auto-flip any finding with `citation_status` in (`hallucinated`, `not_found`) and `verification_status = 'unverified'` to `needs_human` so they stop appearing as letter-ready.
- Backfill once now: for the 19 hallucinated findings across all firms, mark `requires_human_review = true` and `priority = 'low'` so they're hidden from default letter generation until a human signs off.

## Technical Notes

- New stage file: `supabase/functions/run-review-pipeline/stages/evidence-crop.ts`. Register it in the pipeline orchestrator after `verify`.
- Image cropping: use `Deno` `ImageMagick` WASM (already in `_shared/`) — no new deps.
- New edge function: `regroup-citations` that accepts a `plan_review_id`, re-runs `groundCitations` + `verify` against existing `deficiencies_v2` rows.
- UI: extend `usePlanReviewData.ts` to expose `qualityScore` and citation tallies; new component `AIQualityBadge.tsx` in the plan review header.
- One small migration: `ALTER TABLE plan_reviews` not needed — reuse existing `ai_run_progress` jsonb and `evidence_crop_meta` jsonb.
- Backfill for hallucinated findings runs as a one-time `UPDATE` via the insert tool, not a migration.

## Out of Scope

- Lowering verifier threshold further (already at 0.9).
- Changing the dedupe Jaccard threshold (already 0.7).
- Letter template changes — readiness guard already blocks hallucinated citations.

Approve to implement all three.
