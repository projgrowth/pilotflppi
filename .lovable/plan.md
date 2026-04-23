

## Add a global "Pipeline Activity" screen with one-click cancel

### What you'll get

A new page at `/pipelines` (linked from the sidebar as **Pipeline Activity**) that lists every plan review with active or recent pipeline work — across all your projects — with a **Cancel** button on each row. No more hunting for which dashboard is still grinding.

### What the screen shows

For each plan review that has any pipeline rows from the last 24h:

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Project name · Round 2          Mode: Core    [Open] [Cancel]      │
│ 1234 Main St · Hillsborough                                         │
│ ━━━━●━━━━○━━━━○━━━○━━━○━━━○                                          │
│ upload  prepare  sheet  dna  disc  dedupe  complete                 │
│ Currently: discipline_review · running 4m 12s                       │
│ ⚠ Stuck >2 min — likely safe to cancel                              │
└─────────────────────────────────────────────────────────────────────┘
```

Sections on the page:
1. **Active now** — anything with a `running` or `pending` stage. Sorted by oldest start time so the most stuck ones float to the top.
2. **Stuck (no progress >2 min)** — same rows, but flagged with an orange "Stuck" badge so you can spot them immediately.
3. **Recently finished (last 24h)** — read-only history so you can confirm a cancel actually took effect.

Each row has:
- Project name, address, round, and pipeline mode (Core / Deep).
- Mini-stepper showing current stage.
- Elapsed time on the current stage with a "Stuck" warning at >120s.
- **Open** button → jumps to that review's dashboard.
- **Cancel** button → stops the pipeline (only enabled when something is actually running/pending).
- A **Cancel All** button at the top of the Active section for the nuclear option.

### How cancel works

Reuses the exact mechanism already in `ReviewDashboard.tsx`:
1. Write `cancelled_at` into `plan_reviews.ai_run_progress` (the worker's circuit breaker).
2. Mark every `running`/`pending` row in `review_pipeline_status` for that review as `error` with message `"Cancelled by user"` so the UI updates instantly.
3. Toast confirmation; row re-renders as cancelled within ~1s thanks to the existing realtime subscription.

No edge function or DB changes — the cancel sentinel is already wired up end-to-end.

### Where it lives

- New sidebar entry **Pipeline Activity** with a `Activity` icon, placed right under **Plan Review** so it sits with the review workflow.
- A small badge on the sidebar item showing the count of active pipelines (e.g. `Pipeline Activity · 3`) so you notice background work without opening the page.
- Also surfaced as a compact **"3 pipelines running"** chip in the top of the existing Review list page, linking to `/pipelines`.

### Cleanup of current zombie state

Right now the DB has ~20 `pending` rows with `started_at = NULL` (orphans from earlier failed runs). The new page will:
- Treat `pending` rows older than 10 minutes with no `started_at` as **orphaned** and show a "Clear orphaned" button that bulk-marks them as `error` with `"Orphaned — never started"`. One-click cleanup.

### Files to add / change

**New**
- `src/pages/PipelineActivity.tsx` — the new screen.
- `src/hooks/useAllActivePipelines.ts` — query for all `review_pipeline_status` rows in the last 24h joined with `plan_reviews` + `projects`, plus a shared realtime subscription on the `review_pipeline_status` table firm-wide.

**Edit**
- `src/App.tsx` — register `/pipelines` route inside the `AppLayout` guard.
- `src/components/AppSidebar.tsx` — add **Pipeline Activity** nav item with `Activity` icon and live count badge.
- `src/pages/Review.tsx` — add the small "N pipelines running" chip linking to `/pipelines` (optional surface).
- `src/pages/ReviewDashboard.tsx` — extract the existing `cancelPipeline` logic into a small shared helper (`src/lib/pipeline-cancel.ts`) so both the dashboard and the new page share one implementation.

**No backend/edge changes** — the cancellation sentinel and worker behavior already work; we're just adding a centralized UI on top.

### Technical details

- Query: `select * from review_pipeline_status where started_at > now() - interval '24 hours' or status in ('running','pending')` — cap to firm via existing RLS.
- Realtime: one shared channel `pipeline-activity-all` filtered by `firm_id` (using existing `subscribeShared` helper).
- Stuck threshold: `Date.now() - started_at > 120_000 && status === 'running'`.
- Orphan threshold: `status === 'pending' && created_at < now() - 10min && started_at is null`.
- Mode detection: read `plan_reviews.ai_run_progress.mode` (already written by the wizard / re-run buttons).

