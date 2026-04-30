
# Plan Review user-flow audit

I traced the flow from `NewReviewDialog` → `uploadPlanReviewFiles` → `PlanReviewDetail` → pipeline → letter, and replayed your most recent session. Here is what I found, ranked by how badly it hurts users today.

## What I observed in your session (2283 Ringling Blvd)

You created the review, upload started, then within ~70 seconds the UI fired **four stacked toasts**:

1. `Document2.pdf: 6 of its pages failed to rasterize.`
2. `Rasterized 0 of 6 pages — 6 failed.`
3. `Pipeline NOT started — Only 0 of 6 pages prepared. Use "Prepare pages now" to retry the gaps before analyzing.`
4. `Only 0/6 pages prepared. Use "Prepare pages now" in the workspace.`

Then the toasts vanished and you sat on the workspace doing nothing for ~3 minutes. **That is the entire failure** — we surfaced a catastrophic problem in a transient toast and offered no in-page recovery on the route the user was actually on.

---

## Tier 1 — Hard blockers in the current flow

### 1. The "0 of N pages" cliff has no recovery surface

**Why it matters:** When `MIN_RASTERIZE_RATIO` (80%) isn't met, `uploadPlanReviewFiles` writes `ai_check_status = 'needs_user_action'` to the DB and returns. The workspace then relies on `StuckRecoveryBanner` + `ReviewNextStepRail` to surface recovery — but on a *brand new* review, both can render before the page-asset poll has caught up, so the user sees the empty drop-zone with no banner. Toasts disappear in 8s. Recovery is gone.

**Fixes**
- After `partialRasterize === true`, **immediately** call `handleReprepareInBrowser()` once (with a confirmation toast) instead of dumping the user back to the workspace. The browser already has the file in memory and we already proved pdf.js works there.
- If auto-retry still produces 0 pages, surface a **modal** (not a toast) that says "We couldn't render this PDF. Common causes: scanned image PDF, password-protected, or corrupt header. [Try a different file] [Contact support]".
- Stop firing 4 toasts for the same event. Replace with **one** toast: "0 of 6 pages prepared — opening recovery." All the per-file/per-page detail belongs in an expandable "Show details" inside the recovery modal, not in the toast queue.

### 2. `pdfjsLib.GlobalWorkerOptions.workerSrc` points to a CDN

`src/lib/pdf-utils.ts:4` uses `https://cdnjs.cloudflare.com/.../pdf.worker.min.mjs`. If the user is on a restricted network (county VPN, hospital wifi — common for our buyers) the worker fails to load and **every page rasterizes to 0**. This is the most likely root cause of what you just hit.

**Fix:** Bundle `pdfjs-dist/build/pdf.worker.min.mjs` via Vite (`new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)`) so the worker ships with the app.

### 3. Auto-render runs on every mount, ignores deps

`PlanReviewDetail.tsx` lines 250–261: the auto-render effect has `[review]` as its dep array but reads `pageImages.length`, `renderingPages`, `hasAutoRendered.current`. ESLint disable is implicit. On a fresh upload + navigation, this re-fires before `pageImages` propagates and can race the upload's `resetPages()`.

**Fix:** Move the guard into a single `useEffect` keyed on `review.id` only, and gate inside the body.

---

## Tier 2 — Confusing journey moments

### 4. "Just-created" sticky window is 3 minutes — too long

`justCreatedFresh` (line 211) keeps the ProcessingOverlay up for 3 min even when the upload has already errored. A user who hits the rasterize cliff sees "Analyzing your plans…" for minutes while the real state is "needs_user_action."

**Fix:** Drop the sticky window the moment `ai_check_status` becomes `needs_user_action` OR `partialRasterize` resolves. Cap remaining cases at 60s.

### 5. Two competing "next step" surfaces

The page renders both `StuckRecoveryBanner` (with `needsPreparation`/`needs_user_action` variants) **and** `ReviewNextStepRail` (whose selector emits `needs_preparation` / `partial_rasterize`). They overlap on every recovery scenario — risk of two banners with two CTAs.

**Fix:** Delete the `needsPreparation` and `needs_user_action` variants from `StuckRecoveryBanner` and let `ReviewNextStepRail` own them exclusively. Keep `StuckRecoveryBanner` for `needs_human_review` + auto-recovery only.

### 6. NextStepBar (dashboard) and ReviewNextStepRail (workspace) drift

Both compute "what's next" but with different ladders. Reviewers see "Triage 5 findings" on the dashboard while the workspace says "Confirm DNA". Pick one source of truth.

**Fix:** Have `NextStepBar` consume `selectNextStep()` from `src/lib/review-next-step.ts`. Delete its inline ladder.

### 7. The "Analyze" button doesn't know about partial state

If the user manually clicks Analyze when only 4 of 6 pages are prepared, the pipeline starts and silently runs against a partial sheet set. The Top Bar's button has no awareness of `pageAssetCount < expectedPages`.

**Fix:** In `ReviewTopBar`, disable Analyze (with tooltip) when `pageAssetCount < expectedPages * 0.95`.

---

## Tier 3 — Polish that compounds trust

### 8. Upload progress phases say "Preparing pages in your browser…" with no per-page counter

The session shows a single phase string for ~60s. Users assume it's hung.

**Fix:** Change `UploadProgressBar` to render `prepared / expected` from the existing `onProgress` callback (the data is already passed, just not displayed numerically).

### 9. `beforeunload` guard fires forever if upload hangs

If `uploading` stays true (e.g. network drop mid-rasterize), the user can't close the tab without an OS confirm dialog.

**Fix:** Add a 5-min timeout that flips `uploading=false` and shows an error toast.

### 10. No "I uploaded the wrong file" exit

After the bad upload, there is no in-page action to delete the just-uploaded file and try again — the user has to delete the entire review.

**Fix:** When `partialRasterize` or `aiCheckStatus === 'needs_user_action' && stage === 'upload'`, surface a `[Re-upload] [Delete this PDF]` pair in the recovery modal.

---

## Technical notes

- `uploadPlanReviewFiles`'s 80% threshold is correct — don't lower it; instead make recovery automatic.
- `reprepareInBrowser` already handles re-running rasterization against existing `plan_review_files`, so auto-recovery can call it without re-uploading bytes.
- `selectNextStep` already has `partial_rasterize` and `upload_failed` kinds — we just need to actually route the page to act on them on first render, not after a poll.
- Keep `StuckRecoveryBanner`'s `needs_human_review` variant — it's distinct (post-pipeline quality concern, not pre-pipeline blocker).

## Files to change

- `src/lib/pdf-utils.ts` — bundle worker, not CDN.
- `src/lib/plan-review-upload.ts` — emit a single result with structured failure detail; drop redundant warnings.
- `src/hooks/plan-review/useUploadAndPrepare.ts` — auto-trigger `handleReprepareInBrowser` on `partialRasterize`; collapse 4 toasts to 1; add 5-min upload watchdog.
- `src/pages/PlanReviewDetail.tsx` — fix auto-render effect deps; tighten `justCreatedFresh`; mount a recovery modal.
- `src/components/plan-review/StuckRecoveryBanner.tsx` — remove `needsPreparation`/`needs_user_action` variants.
- `src/components/plan-review/ReviewTopBar.tsx` — disable Analyze on partial manifest.
- `src/components/plan-review/UploadProgressBar.tsx` — show numeric `prepared / expected`.
- `src/components/review-dashboard/NextStepBar.tsx` — consume `selectNextStep`.
- New `src/components/plan-review/UploadFailureRecoveryDialog.tsx`.

## Out of scope

- Pipeline-stage logic (Tier 1 input-layer changes already shipped).
- Letter generation / readiness gate (separate audit).
- Mobile layout (workspace is desktop-first by design).

Approve and I'll implement Tier 1 + 2 first; Tier 3 can ship in the same pass.
