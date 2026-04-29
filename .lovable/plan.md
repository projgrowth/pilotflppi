# Phase 4 — Remaining Wire-Crossing & Hallucination Risks

After Phases 1-3, four real footguns remain. Three are confirmed by current logs/code; one is preventative.

## 1. Realtime crash on plan-review page (HIGH — confirmed in console)

`PipelineProgressStepper` opens its own channel `pr-progress-${planReviewId}` and calls `.on("postgres_changes", ...).subscribe()` directly. On any remount (StrictMode dev double-mount, route transition, parent re-render that changes `key`), Supabase reuses the existing channel object and the second `.on()` call after `.subscribe()` throws:

> `cannot add postgres_changes callbacks for realtime:pr-progress-... after subscribe()`

This is exactly the bug `RouteBoundary` is catching right now on `/plan-review/344a5783...` — it crashes the whole route into the error boundary.

We already solved this elsewhere with `subscribeShared()` in `useReviewDashboard.ts` (ref-counted shared topic registry). The stepper just isn't using it.

**Fix:** route the stepper's subscription through `subscribeShared()` (or a small dedicated wrapper) so a single channel is reused across mounts and the second `.on()` never happens. Same pattern as `useDeficienciesV2`.

## 2. `ai_run_progress` lost-update race (HIGH — silent data loss)

Five different writers all do read-modify-write on the same JSONB column with no atomicity:

```text
stages/complete.ts          stages/discipline-review.ts (×2)
stages/submittal-check.ts   index.ts (dispatch self-update)
```

Pattern in every one:
```ts
const { data } = await admin.from("plan_reviews").select("ai_run_progress")...
const prev = data?.ai_run_progress ?? {};
await admin.from("plan_reviews").update({ ai_run_progress: { ...prev, key: newVal } })...
```

When two stages run concurrently (very common during fan-out: `discipline-review` heartbeats while `submittal-check` finishes), one overwrite wins and the other's keys vanish. Symptoms users would see: progress chunk counter resets to 0, DNA confirmation flag disappears, mode flips back to `core` mid-run.

**Fix:** add a Postgres helper `merge_review_progress(plan_review_id uuid, patch jsonb)` that does a single atomic `UPDATE ... SET ai_run_progress = COALESCE(ai_run_progress, '{}') || $patch` and call it from all five writers. One migration + 5 small refactors.

## 3. Dispatcher "stuck_no_progress" loops (MEDIUM — confirmed)

Two `dispatch` errors logged in the last 24h with `error_class=stuck_no_progress`. Combined with the edge logs showing 3 `[stage:upload] No files uploaded` retries on a fresh review, this means a project can enter the dispatch loop before any file has actually finished uploading — the pipeline retries 3× then logs an error, but the run isn't transitioned to `needs_user_action` (Phase 2 only handled rasterization/partial-upload, not "zero files at dispatch time").

**Fix:** in `stages/upload.ts`, when count is zero on the FINAL retry attempt, flip `ai_check_status='needs_user_action'` with an explicit reason "no files uploaded — re-upload PDF" instead of just throwing. Surfaces immediately in the existing banner.

## 4. DialogContent a11y warnings → mask real errors (LOW)

Console shows `Missing Description or aria-describedby` warning from a `DialogContent`. `NewReviewDialog` already has `aria-describedby="new-review-desc"` — the offender is one of: `ProcessingOverlay`, `LetterLintDialog`, `RecordDeliveryDialog`, `DeleteConfirmDialog`, etc. Noisy a11y warnings train devs to ignore the console and miss real errors.

**Fix:** add `<DialogDescription>` (or `aria-describedby` + sr-only text) to every `DialogContent` lacking one. ~5min sweep.

---

## Out of scope (audited, not problems)

- **Edge function `createClient` cast to `any`** in `_shared/supabase.ts` — intentional to avoid Deno↔Node type drift; behaviour is fine.
- **`as unknown as` casts on `ai_run_progress`** in `PlanReviewDetail.tsx` — types are honest; would only matter if shape drifted (Issue #2 above prevents that better than typing).
- **Telemetry severity** — Phase 1 is working: 67 info / 2 warn / 0 error in last 24h with the 2 warns being legit `dispatch:stuck_no_progress` (Issue #3).

## Files to touch

- `src/components/plan-review/PipelineProgressStepper.tsx` — use shared subscription
- `src/hooks/useReviewDashboard.ts` — export `subscribeShared` if not already (it is)
- New migration: `merge_review_progress(uuid, jsonb)` SQL function
- `supabase/functions/run-review-pipeline/_shared/pipeline-status.ts` — add `mergeProgress()` helper that calls the RPC
- `supabase/functions/run-review-pipeline/{index.ts, stages/complete.ts, stages/discipline-review.ts, stages/submittal-check.ts}` — replace 5 read-modify-write blocks with `mergeProgress()`
- `supabase/functions/run-review-pipeline/stages/upload.ts` — flip to `needs_user_action` when 0 files on final attempt
- Sweep `src/components/**/Dialog*.tsx` and any `DialogContent` usages for missing descriptions

Approve and I'll implement all four in one pass.