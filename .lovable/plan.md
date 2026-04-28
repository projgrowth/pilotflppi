
## Audit: what's wrong today

A user who wants to "upload plans and review them" currently passes through up to **6 distinct UI surfaces**:

```text
Projects (list)  ─►  NewPlanReviewWizard Step 1 (upload)
                 ─►  NewPlanReviewWizard Step 2 (confirm AI fields)
                 ─►  NewPlanReviewWizard Step 3 (wait / "Open workspace")
                 ─►  /plan-review/:id (workspace)
                 ─►  /plan-review/:id/dashboard (triage)

Plus a parallel funnel:
/review (list) ─► /review/:id (redirect shim) ─► /plan-review/:id
```

Findings from reading the code:

1. **`NewPlanReviewWizard.tsx` is 1,007 lines** and re-implements an upload widget, AI title-block extraction, geocoding, project-match dedupe, *and* a pipeline-progress waiting room — none of which the workspace can't already show.
2. **Step 3 is dead time.** The Dialog just renders `PipelineProgressStepper` + `PagePrepProgress` then offers two buttons that both navigate to `/plan-review/:id`. The workspace already shows that exact pipeline state via `usePipelineStatus` and the `StuckRecoveryBanner`.
3. **`/review` and `/review/:id` are duplicate funnels.** `Review.tsx` is a project list filtered to "reviews", and `ReviewDetail.tsx` is a 3-line redirect-or-create-row shim. Both end at `/plan-review/:id`.
4. **Two "New Review" entry points** (`Projects` button → wizard, `Review` button → `/projects?action=new` → wizard) confuse the mental model.
5. **AI extraction blocks Step 2.** The user can't proceed until 20s of title-block OCR finishes, even though every field is already manually editable.
6. **`PlanReviewDetail` already has an in-page drop zone** (`PlanViewerPanel`, `handleFileUpload` at line 230) — the wizard re-implements the same upload pipeline a second time.

Net effect: more screens, more redirects, more state to keep in sync, more places where the legitimacy work in P0/P1 (snapshots, readiness gates, holiday math) can be bypassed by a stale wizard branch.

## Proposed flow (3 surfaces total)

```text
Projects (list + inline "New Review" button)
   │
   │  click "New Review"  →  small modal: 1 form, no steps
   │     • drop PDFs (multi)
   │     • address (auto-geocodes county+jurisdiction on blur)
   │     • use type toggle (commercial / residential)
   │     • trade + services (defaults: building + plan_review)
   │     • [optional] AI auto-fill button  ← non-blocking, runs in background
   │     [Create & Open]
   ▼
/plan-review/:id   ← single workspace
   • upload more files via the existing in-page drop zone
   • pipeline progress shown inline in the existing top strip / StuckRecoveryBanner
   • findings, letter, QC, snapshots — unchanged
```

Two screens in the happy path. Three if you count the project list.

## Concrete changes

### 1. Replace the 3-step wizard with a single-form modal
- New `NewReviewDialog.tsx` (~250 lines, replaces `NewPlanReviewWizard.tsx`).
- One scrollable Dialog body, no `step` state, no `STEPS` indicator, no Step 3.
- AI extraction becomes an optional **"Auto-fill from title block"** button next to the file list. It populates fields when it returns; user can submit before it finishes.
- Geocode runs on `address` blur (already implemented), with a manual `MapPin` fallback. No separate "Confirm" step.
- `[Create & Open]` does the existing `handleLaunch` work (insert project + plan_review row + kick pipeline) and immediately `navigate('/plan-review/:id')`. The pipeline runs while the workspace mounts — the workspace already polls `usePipelineStatus` and renders the same stepper.

### 2. Delete the `/review` and `/review/:id` detour
- Remove `src/pages/Review.tsx` and `src/pages/ReviewDetail.tsx`.
- Remove their routes from `src/App.tsx`.
- Update the sidebar entry "Plan Review" to point at `/projects?filter=plan_review` (uses the existing filter pill in `Projects.tsx`).
- Update `useActivePipelineCount` banner placement: move it into the `Projects` page header so the "N pipelines running" affordance is preserved.
- Add a redirect: `/review/:id  →  /projects/:id` (so external links from email/snapshots don't 404).

### 3. Single "New Review" entry point
- Keep the Projects page button.
- Remove the duplicate button on the (now-deleted) Review page.
- `ProjectDetail` keeps its "Start new round" button — it opens the same `NewReviewDialog` with `preselectedProjectId`, so existing-project re-submittals stay one click.

### 4. Fold the wizard's Step-3 waiting room into the workspace
- Add a small `<PipelineKickoffToast />` (or reuse `UploadProgressBar`) on `/plan-review/:id` that is visible only when no `page_assets` exist yet, then auto-dismisses. The `StuckRecoveryBanner` and `PipelineProgressStepper` already handle the rest.
- Removes ~150 lines from the wizard and one full screen of "waiting" UX.

### 5. Tighten the in-page upload
- `PlanViewerPanel`'s drop zone stays (additive uploads for resubmittals).
- The new modal and the in-page drop zone share **one** helper (`uploadPlanReviewFiles` — already exists in the codebase as the back end of `handleFileUpload`); the wizard's parallel implementation is deleted.

## What stays unchanged

- All P0/P1 legitimacy work: holiday-aware deadlines, immutable letter snapshots, readiness gate, QC notes, evidence cropping, override-reason enforcement.
- `PlanReviewDetail` workspace layout (PDF + findings + letter + right-panel tabs).
- `ReviewDashboard` (`/plan-review/:id/dashboard`) — kept as the QC/health view; it's a different job, not part of the upload→review path.

## Files touched

- **New:** `src/components/NewReviewDialog.tsx`
- **Delete:** `src/components/NewPlanReviewWizard.tsx`, `src/pages/Review.tsx`, `src/pages/ReviewDetail.tsx`
- **Edit:** `src/App.tsx` (routes + redirect), `src/pages/Projects.tsx`, `src/pages/ProjectDetail.tsx`, `src/pages/PlanReviewDetail.tsx` (kickoff toast), sidebar nav component
- **Refactor:** extract shared `uploadPlanReviewFiles` helper if not already standalone

## Open questions before I implement

1. The `Review.tsx` page also surfaces a per-project **`ReviewStagePipeline`** + **`ConfidenceBar`** card grid — useful at-a-glance triage. OK to drop these (they're available per-project on `ProjectDetail`), or should I add a "Reviews" filter view on `Projects` that keeps that card layout?
2. Should the AI title-block auto-fill run **automatically on upload** (current behavior, blocking) or only when the user clicks **"Auto-fill"** (faster, less magical)? My recommendation: auto-run in background, non-blocking — show a small "AI filled X fields" toast when it returns.
3. Keep `/plan-review/:id/dashboard` as a separate route, or merge it as a tab inside `/plan-review/:id`? (Out of scope for "upload + review" simplification, but related.)
