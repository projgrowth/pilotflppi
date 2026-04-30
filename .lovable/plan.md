## Problem

After "Create & Open" in `NewReviewDialog`, we navigate the user to `/plan-review/:id` (the **workspace** — left = PDF viewer, right = findings). That page is built for *reviewing findings against the plan*, not for *watching a job run*. Even with `ProcessingOverlay`, the surrounding chrome (ReviewTopBar with "Re-Analyze", findings panel, letter tab, "Run AI Check" button) screams "you're done, start working" — so users assume the analysis is finished and get confused when there's nothing to click.

Meanwhile, `/plan-review/:id/dashboard` (the Review Dashboard) is *already* the right surface for an in-flight run: `ReviewStatusBar` stage chips, `ReviewHealthStrip`, `NextStepBar`, the alert stack, Cancel/Re-run, recovery banners, and the deficiency triage inbox that fills in as findings stream.

## Proposed Flow

```text
Create & Open
   │
   ▼
/plan-review/:id/dashboard   ← NEW default landing
   │   "Analyzing your plans" hero with live stepper,
   │   page-prep counter, ETA, Cancel button.
   │   Findings list fills below as they stream.
   │
   ├── (any time) [View plan ▸]  → /plan-review/:id    (the workspace)
   │
   └── (auto) when pipeline_status = complete AND findings > 0
                "Review N findings on the plan ▸"  CTA appears
                → opens workspace, jumps to first finding
```

The workspace stops being the "you just uploaded" page and becomes the "review findings on the PDF" page — which is what it's actually designed for.

## Changes

### 1. NewReviewDialog — change landing route
`src/components/NewReviewDialog.tsx` line 433: navigate to `/plan-review/${review.id}/dashboard` instead of `/plan-review/${review.id}`. Keep the `justCreated` location state.

### 2. ReviewDashboard — make it "run-aware"
`src/pages/ReviewDashboard.tsx`:
- Read `location.state.justCreated` and `pendingFileCount` / `pendingPageCount`.
- When `isPipelineActive` OR `justCreated`, render a top **"Analyzing your plans"** hero card above `ReviewHealthStrip` containing:
  - Headline ("Reviewing 24 sheets across 2 PDFs"), ETA, elapsed timer.
  - The existing `PipelineProgressStepper` (compact mode).
  - `UploadProgressBar` / page-prep counter (reuse the components already used in workspace).
  - Cancel button (already exists in header — leave there).
  - "Safe to close — analysis runs in the background" reassurance.
- Hide tabs (Triage / Audit / Letter) behind a "Findings will appear here" empty-state until first finding lands, instead of showing empty tabs.
- When pipeline reaches `complete` AND `defs.length > 0`, swap the hero for a green **"Analysis complete — N findings ready"** CTA card with a primary button: **"Review on the plan →"** that routes to `/plan-review/:id?finding=<firstId>`.

### 3. Workspace — remove the "we just uploaded" responsibility
`src/pages/PlanReviewDetail.tsx`:
- Delete the `ProcessingOverlay` rendering path (the dashboard now owns it). Keep `UploadFailureRecoveryDialog` because file-side recovery still lives here.
- If a user lands on the workspace while pipeline is still running and there are zero findings yet, show a slim banner at top: **"Still analyzing… [View progress on dashboard ▸]"** instead of an overlay. They can browse the PDF; nothing pretends to be done.
- Add **"View plan ▸"** is already in the dashboard header (line 457-461) — keep it. Add the inverse **"Pipeline dashboard ▸"** in the workspace `ReviewTopBar` (already partially exists via `onOpenDashboard`) — promote it to a visible button when `pipelineProcessing` is true rather than buried in the dropdown.

### 4. Pipeline-complete notification
`src/hooks/usePipelineCompleteNotifications.ts` — when a pipeline finishes and the user is currently on `/plan-review/:id/dashboard`, suppress the toast (the in-page CTA replaces it). Keep the toast for users who navigated away.

### 5. Sidebar / breadcrumb wording
Rename the dashboard route's page title from "Review dashboard" to **"Plan review run"** so the mental model is clear: dashboard = the *run*, workspace = the *plan*.

## What this fixes

- No more "looks finished but isn't" — the page the user lands on is unambiguously a progress page.
- The workspace stays clean for its real job (annotating findings on a PDF).
- One source of truth for run state (`ReviewStatusBar` + alerts) instead of duplicating it inside the workspace overlay.
- Recovery flows (re-prepare, cancel, DNA blockers) are already wired into the dashboard — users see them sooner.

## Out of scope

- No DB or pipeline-stage changes.
- No changes to the upload helper or pdf.js worker.
- Round switching / multi-round nav stays in the workspace top bar.
