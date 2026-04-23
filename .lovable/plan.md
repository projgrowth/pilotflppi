

# Backend reliability round 6 — stop the silent failures and bad recoveries

The data shows three categories of pain. None require AI changes.

```text
Real failures in the last 24h
  4 reviews failed by auto-recovery on upload/prepare_pages
    → these stages need browser context; server retry CAN'T help, just wastes a retry slot
  2 reviews "complete" with 0 findings + 1 page asset
    → silent failure: pipeline ran on a bad/empty upload, marked itself complete
  1 review stuck in 'error' status (a dead state nothing handles)
  0 active long-running queries → DB is healthy, edges aren't
```

## 1. Recovery cron must skip stages it can't fix

`reconcile-stuck-reviews` happily retries `upload` and `prepare_pages`. Both require the **browser** to rasterize PDFs — a server-side worker re-kick does nothing useful, then the second tick marks the review failed. We're auto-failing recoverable reviews.

Fix:
- Add `SERVER_RECOVERABLE_STAGES = ['dna_extract','sheet_map','discipline_review','cross_check','ground_citations','verify','letter_draft']`. Only retry those.
- For browser-context stages (`upload`, `prepare_pages`): instead of retrying, flip `ai_check_status='needs_user_action'` (new value) with a clear `failure_reason: "Upload incomplete — please re-open the project to finish preparing pages."`. The dashboard already has a banner pattern; wire it to this status.
- Result: the 4 false-failures from this morning would have been parked for the user instead of burned.

## 2. Add a "found nothing" guard

Two reviews completed with zero findings AND only 1 page asset (almost certainly bad rasterize → DNA empty → AI saw nothing). `stageComplete` should refuse to mark a multi-page review complete with zero findings unless an explicit "no issues found" assertion exists.

Fix:
- At end of `stageDisciplineReview`: if `total_findings === 0 && expected_pages > 5`, throw `LOW_YIELD_REVIEW` (new error class) with metadata `{pages, sheets, dna_completeness}`.
- Pipeline marks status `needs_human_review` (not `complete`) and writes `failure_reason`. The dashboard's existing failure banner surfaces it; reviewer can manually approve or re-run.
- This catches every silent-failure pattern we've actually seen, not just upload-related ones.

## 3. Resolve the dead `error` status

One review is in `ai_check_status='error'` since April 22 — the value isn't in the dispatcher's known states, so it's stranded. Either every code path emits it (it doesn't) or it's a leftover from an old version.

Fix:
- One-time migration: `UPDATE plan_reviews SET ai_check_status='failed', ai_run_progress = ai_run_progress || jsonb_build_object('failure_reason','Legacy error state — reset by maintenance') WHERE ai_check_status='error';`
- Dispatcher: explicitly accept `error` as equivalent to `failed` for re-run eligibility (defense in depth).
- Add a Postgres CHECK constraint on `plan_reviews.ai_check_status` so future drift can't reintroduce unknown values: `CHECK (ai_check_status IN ('pending','running','complete','failed','needs_user_action','needs_human_review'))`.

## 4. Make pipeline retries cost-aware

`NON_FATAL_RETRY_STAGES` retries 3× with no backoff metadata. When `discipline_review` fails on chunk 7 of 10, we re-run from chunk 1 — paying for 6 chunks twice. The model already takes JSON input; we can checkpoint chunk results.

Fix:
- New table column `plan_reviews.stage_checkpoints jsonb` (default `{}`) — store `{discipline: lastChunkCompleted}` after each chunk.
- On retry, `runDisciplineChecks` skips chunks already represented by upserted `def_number`s for that discipline.
- Result: retried discipline_review costs proportional to the failure point, not a full rerun.

## 5. Edge function timeout safety net

Edge functions hard-cap at ~150s on Lovable Cloud. Long discipline_review chains can hit the wall mid-stage and leave the review in `running` forever (until cron rescues it). We should self-trigger continuation.

Fix:
- Track `stageStartedAt` per stage. If `Date.now() - stageStartedAt > 120_000` mid-loop, write current progress, return 200 with `{continuation: true, plan_review_id}`, and the dispatcher (or a wrapping `Deno.serve` handler) immediately re-invokes itself.
- Net effect: long reviews finish via several short invocations instead of one long one that gets killed.

## 6. Pipeline error log retention + indexing

`pipeline_error_log` has no retention policy. Today it's small, but at scale (one chunk_summary per chunk per discipline per review) it grows linearly with usage. Plus it has no index on `(plan_review_id, created_at)` — the dashboard queries are getting slower.

Fix:
- Migration: `CREATE INDEX pipeline_error_log_review_created_idx ON pipeline_error_log (plan_review_id, created_at DESC);`
- Add a daily cron job: delete `pipeline_error_log` rows older than 90 days where `error_class IN ('chunk_summary','stuck_no_progress')` (the noisy informational ones). Keep real errors forever.

## 7. Storage object cleanup for failed uploads

When upload fails, we leave PDFs orphaned in `documents/plan-reviews/<id>/`. They're never deleted, never viewable. Storage cost grows silently.

Fix:
- New scheduled function `cleanup-orphan-uploads` (daily): for each `plan_reviews` row with `ai_check_status='failed'` AND `created_at < now() - interval '30 days'`, list+delete its objects under `plan-reviews/<id>/` from the `documents` bucket. Log totals to `pipeline_error_log`.

## 8. Database-level firm_id enforcement

Several recent inserts (e.g., `pipeline_error_log` from edge functions running with service role) skip `firm_id`. RLS on read still works because of the `firm_id IS NULL OR ...` policy, but admin queries get noisy and cross-firm leakage is one careless join away.

Fix:
- For edge-inserted tables (`pipeline_error_log`, `plan_review_page_assets`), require firm_id by deriving it from the parent `plan_review` server-side at insert time. Add a trigger `set_firm_id_from_plan_review` that fills `NEW.firm_id` from `(SELECT firm_id FROM plan_reviews WHERE id = NEW.plan_review_id)` if null.
- Tighten the read policies: drop the `firm_id IS NULL` escape hatch — every row must belong to a firm. Backfill nulls in a one-time migration.

## Files changed

```text
EDIT
  supabase/functions/reconcile-stuck-reviews/index.ts
    • Skip non-server-recoverable stages → flip to needs_user_action
  supabase/functions/run-review-pipeline/index.ts
    • LOW_YIELD_REVIEW guard at end of discipline_review
    • Stage checkpoint resume in runDisciplineChecks
    • Self-continuation on 120s mid-stage timeout
    • Accept 'error' status as re-runnable
  src/components/plan-review/StuckRecoveryBanner.tsx
    • Render needs_user_action variant ("re-open to finish preparing pages")
  src/types/index.ts (or wherever plan_review status lives)
    • Add 'needs_user_action' | 'needs_human_review'

CREATE
  supabase/functions/cleanup-orphan-uploads/index.ts
    • Daily storage cleanup for >30d failed reviews
  supabase/migrations/<ts>_pipeline_hardening.sql
    • CHECK constraint on plan_reviews.ai_check_status
    • UPDATE legacy 'error' rows to 'failed'
    • ADD COLUMN plan_reviews.stage_checkpoints jsonb DEFAULT '{}'
    • CREATE INDEX pipeline_error_log_review_created_idx
    • CREATE TRIGGER set_firm_id_from_plan_review
    • Backfill firm_id NULLs; tighten RLS to drop NULL escape hatch
    • cron.schedule daily cleanup-orphan-uploads + log retention DELETE
```

## Verification

- Force-stale a `pending` review at `prepare_pages` → cron flips to `needs_user_action`, banner appears, NOT failed.
- Run pipeline against a corrupt PDF → fails at `LOW_YIELD_REVIEW`, status `needs_human_review`, dashboard surfaces it.
- Kill discipline_review at chunk 5/10 mid-run → next dispatcher tick resumes at chunk 6, not chunk 1 (verify via `chunk_summary` log count).
- Insert a row into `plan_reviews` with `ai_check_status='garbage'` → blocked by CHECK constraint.
- Edge function inserts a `pipeline_error_log` row without firm_id → trigger fills it from the parent review.

No UI redesign. No prompt changes. All seven fixes are independent — can ship in any order, but #1 and #2 are highest leverage (they would have prevented every issue currently visible in the database).

