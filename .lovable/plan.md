# Audit: "Prepare pages — pages haven't been prepared" in the wizard

## What's happening on the failing review

Review `b443092b…f3bc8daff90b` (SUNCOAST PORSCHE, 78-page Arch set):

- `plan_review_files`: 1 PDF registered ✓
- `plan_review_page_assets`: **0 rows** ✗
- `pipeline_error_log`: 1 × `needs_browser_rasterization` from `prepare_pages` (retried 3×, then dead)
- Wizard UI shows "Finishing on server 0 / 78" — but the server-side rasterizer was deliberately removed (see `stages/prepare-pages.ts` — verify-only, throws `NEEDS_BROWSER_RASTERIZATION` whenever the manifest is empty)

So the pipeline is working as designed. The bug is upstream: **the wizard's background rasterizer produced 0 page assets, then started the pipeline anyway, then told the user to "Retry" — but the Retry button only re-invokes the pipeline (which will keep failing forever because no browser is going to re-rasterize)**.

## Three real defects

### 1. Wizard duplicates `uploadPlanReviewFiles` instead of using it
`src/components/NewPlanReviewWizard.tsx` (handleLaunch, lines 392–517) hand-rolls the upload + rasterize + pipeline-start sequence. Meanwhile `src/lib/plan-review-upload.ts` already does this correctly with the **MIN_RASTERIZE_RATIO = 0.8 guard** — i.e. it refuses to start the pipeline when fewer than 80% of pages were prepared and returns `partialRasterize: true` so the UI can surface a recovery CTA.

The wizard's hand-rolled version has none of that:
- No success-ratio check — fires `invokePipeline` even when 0/78 pages rasterized
- No `expected_pages` stamp on `ai_run_progress` (only `total_pages`), so `reprepareInBrowser`'s gap-repair planner can't reconcile anything
- Silently swallows rasterization errors with `console.warn` — the user never learns *why* 0/78 happened
- No retry of failed page batches

### 2. The "Retry analysis" button is the wrong action
When `prepare_pages` fails with `needs_browser_rasterization`, re-invoking the pipeline does nothing useful — the manifest is still empty, so `prepare_pages` will throw the same error on the next attempt. The user needs to **re-run rasterization in this browser tab**, which is exactly what `reprepareInBrowser()` does (already wired into `ReviewDashboard` and `PlanReviewDetail` via `ReviewHealthStrip`).

### 3. The wizard's progress strip lies
`PagePrepProgress` reads `total_pages` and `pre_rasterized_pages`. The wizard writes those, but `uploadPlanReviewFiles` writes `expected_pages` instead. So whichever entry point you use, the other one's UI is wrong. Pick one schema and stick with it.

---

# Plan — three changes, ~120 lines net

### A. Replace the wizard's hand-rolled upload with `uploadPlanReviewFiles`
`NewPlanReviewWizard.tsx > handleLaunch`:
- After creating the `projects` and `plan_reviews` rows, call `uploadPlanReviewFiles({ reviewId, round: 1, existingFileUrls: [], existingPageCount: null, files: uploadedFiles.map(u => u.file), userId, onProgress })`.
- Drive `PagePrepProgress` from the `onProgress` callback (set local state `{ prepared, expected, phase }`) instead of the DB poll, so the progress strip reflects what's actually happening in *this* tab.
- Read `result.partialRasterize` and `result.pipelineStarted` to decide what to render in Step 3.

Delete the inline upload / rasterize / `invokePipeline` block (lines ~392–517) — it's all in `uploadPlanReviewFiles` now.

### B. Replace "Retry analysis" with a context-aware recovery CTA
Step 3 panel logic:

| State | CTA |
|---|---|
| `result.partialRasterize === true` OR pipeline error contains `needs_browser_rasterization` | **"Re-prepare in this browser"** → calls `reprepareInBrowser(createdReviewId)` |
| Other pipeline-start error | Keep **"Retry analysis"** → calls `invokePipeline` |
| Pipeline running normally | No CTA, just the stepper |

Show a clear inline explanation when partial: *"Your browser only prepared X of Y pages. Click below to finish — keep this tab open."*

### C. Unify the progress schema
In `uploadPlanReviewFiles` (and `reprepareInBrowser`), also write `total_pages` alongside `expected_pages` and `pre_rasterized_pages`. One-line change in two places. Existing `PagePrepProgress` keeps working everywhere with no UI churn.

### D. Self-heal the existing stuck review (one-shot)
For SUNCOAST PORSCHE specifically (`b443092b…`): once Change A is shipped, the user can click the new **Re-prepare in this browser** CTA from the dashboard's `ReviewHealthStrip` (already wired) and the 78 pages will render locally, then the pipeline restarts automatically. No migration needed.

---

# Files touched

- `src/components/NewPlanReviewWizard.tsx` — replace `handleLaunch` upload block; replace Retry CTA with recovery branch; pass `onProgress` to local `PagePrepProgress` state.
- `src/lib/plan-review-upload.ts` — also write `total_pages` to `ai_run_progress` so the wizard's polling progress bar matches.
- `src/lib/reprepare-in-browser.ts` — same one-line addition for consistency.
- `src/components/plan-review/PagePrepProgress.tsx` — accept optional `localProgress` prop so the wizard can drive it directly (avoids a 1.2s polling delay during step 3).

# Out of scope (intentional)

- No edge-function changes — `stages/prepare-pages.ts` is correctly a verify-only gate; bringing back server-side MuPDF rasterization is what we just spent rounds 1–6 removing.
- No DB schema changes.
- No UI redesign of the wizard or recovery banner — copy/CTA only.

# Risk

Low. `uploadPlanReviewFiles` is the same code path used by the dashboard's "+ Add files" flow today, so this is consolidating two divergent implementations onto the well-tested one. The user-visible behavior change is: when rasterization is incomplete, they see "Re-prepare in this browser" instead of a Retry button that can't actually fix anything.