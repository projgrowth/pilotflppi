## Problem

The "Creating..." button hangs for several minutes (or appears frozen) when uploading a 78-page PDF like the Suncoast Porsche plan.

### Root cause

In `NewPlanReviewWizard.tsx` `handleLaunch`, after the project + `plan_reviews` row are inserted, the wizard does **all of this inline before flipping to Step 3 ("Analyzing")**:

1. Uploads the original PDF to storage.
2. Calls `rasterizeAndUploadPages` — which loops every page (78 of them), renders each to a JPEG canvas in batches of 4 at 96 DPI, and uploads each JPEG to storage sequentially per batch.
3. Inserts `plan_review_files`, upserts 78 `plan_review_page_assets` rows.
4. THEN sets `step = 3` and invokes the pipeline.

While all of that runs, the button just shows "Creating…" with no progress, no page count, no cancel. On a slower machine / large PDF, browser PDF.js rasterization of 78 pages easily takes 3–8 minutes. If a single page worker stalls or memory pressure hits, it can appear frozen indefinitely. There is also no timeout, so a hung worker = forever-stuck button.

This is exactly the symptom you're seeing.

## Fix

Three changes, scoped tightly:

### 1. Move the user past "Creating…" immediately

Restructure `handleLaunch` so the wizard advances to Step 3 (the live "Analyzing" view with the pipeline stepper) **as soon as the project + review row + original PDF upload + `plan_review_files` insert succeed**. Rasterization then continues in the background while the user already sees the analysis screen.

Order becomes:
1. Insert/select project, insert plan_review.
2. Upload original PDF(s) to storage.
3. Insert `plan_review_files` rows.
4. `setStep(3)` and `setSaving(false)` — user is now on the Analyzing screen.
5. Kick off rasterization as a fire-and-forget async task that upserts `plan_review_page_assets` as pages complete and updates `ai_run_progress` with `{ pre_rasterized_pages: N, total_pages: 78 }`.
6. Once rasterization finishes (or after a short head-start), invoke the pipeline. The pipeline already has a server-side rasterization fallback for any pages that didn't pre-rasterize.

### 2. Show real rasterization progress on Step 3

Add a small progress strip on the Step 3 "Analyzing your plans" panel:
- "Preparing pages: 24 / 78" with a thin progress bar, sourced from `ai_run_progress.pre_rasterized_pages` / `total_pages`.
- Hides itself once `pre_rasterized_pages === total_pages` or the pipeline has already moved past `intake`.

This means even if pre-rasterization is slow, the user can SEE it advancing instead of staring at "Creating…".

### 3. Hard timeout + graceful fallback on browser rasterization

In `rasterizeAndUploadPagesResilient`:
- Wrap each per-page render in a 20-second `Promise.race` timeout. On timeout, record the page as a failure and continue — do not let one stuck PDF.js worker freeze the entire flow.
- If total prep exceeds 90 seconds OR more than 25% of pages fail to render in the browser, stop client rasterization, mark `ai_run_progress.client_raster_aborted = true`, and let the existing server-side rasterizer in the pipeline handle the rest. The pipeline already tolerates missing page assets.

## Files to edit

- `src/components/NewPlanReviewWizard.tsx` — restructure `handleLaunch` (the order described above), add the "Preparing pages" progress strip to the Step 3 panel.
- `src/lib/pdf-utils.ts` — add per-page timeout + global abort threshold inside `rasterizeAndUploadPagesResilient`, plus an optional `onProgress(done, total)` callback.
- `src/hooks/useReviewPipelineStatus.ts` (or wherever Step 3 reads `ai_run_progress`) — surface `pre_rasterized_pages` / `total_pages` so the new progress strip can render them.

## What this does NOT change

- No DB schema changes.
- No edge function changes — the pipeline already has a server-side rasterization fallback.
- No change to the pipeline behaviour itself; this is purely a UX + resilience fix in the upload step.

## Outcome

For the Porsche upload you're stuck on right now: the wizard would move to "Analyzing" within ~10 seconds (just project + PDF upload), show "Preparing pages: X / 78" advancing live, and the pipeline would start as soon as enough pages are ready — instead of "Creating…" with no feedback for 5+ minutes.

Approve and I'll implement.