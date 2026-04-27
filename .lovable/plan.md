# Fix: discipline_review feels stuck for 60-90s

## Diagnosis

The stage isn't broken — the most recent run (`6b679f01...`) completed cleanly: 10 chunks across 73 architectural sheets, total ~117s. But:

1. **Chunks run sequentially** — one Gemini vision call at a time, ~5-15s each. With 10 chunks that's 60-150s of wall time.
2. **One chunk paused ~60s** between chunks 4→5 (Gemini latency spike), tripping the 120s soft timeout and forcing a worker handoff (visible as `chunk_resume` in `pipeline_error_log`).
3. **UI shows only the stage name.** `PipelineProgressStepper` has no idea we're "on chunk 5/10" — so a slow chunk looks like a hang.

Three fixes, ordered by impact:

## 1. Surface chunk-level progress in `ai_run_progress` (UI fix — biggest perceived win)

**Edit `supabase/functions/run-review-pipeline/stages/discipline-review.ts`:**
- After each chunk completes, write `discipline_review_progress: { discipline, chunk: N, total: M, findings_so_far: K }` into `plan_reviews.ai_run_progress` (already a JSON column — no migration).
- Also write `last_chunk_at` timestamp so the UI can show "still working — last chunk 12s ago".

**Edit `src/components/plan-review/PipelineProgressStepper.tsx`:**
- When current stage is `discipline_review`, read `ai_run_progress.discipline_review_progress` and render a sub-line: `"Architectural — chunk 5 of 10 (8 findings so far)"`.
- Show a stale-watchdog hint if `Date.now() - last_chunk_at > 30s`: `"Vision model is taking longer than usual…"`.

**Edit `src/hooks/plan-review/usePlanReviewData.ts`:**
- The realtime subscription on `plan_reviews` already fires on `ai_run_progress` updates, so chunk progress will stream live with no extra wiring.

This alone removes the "stuck" feeling — even 90s of work feels fine when the user can see chunks ticking up.

## 2. Run chunks in parallel within a discipline (real speedup, ~3-4×)

Each chunk is an independent Gemini call. Currently a `for` loop awaits each one.

**Edit `discipline-review.ts`:**
- Replace the per-discipline sequential `for (chunk of chunks)` with `Promise.allSettled` in batches of **3 concurrent chunks**.
- 3 is the right ceiling: high enough to crush the 10-chunk Architectural set in ~3 rounds (~30-45s instead of 100-150s), low enough to stay under the Lovable AI Gateway burst limit and not blow the 150s edge function budget.
- Keep the existing per-chunk checkpoint write — but persist the *highest contiguous* completed chunk so resume logic stays correct after parallel completion.
- Errors in one chunk no longer block the others; failed chunks get logged to `pipeline_error_log` with `error_class: "chunk_failed"` and the stage continues. A discipline only fails the stage if **>50%** of its chunks fail.

## 3. Tighten the soft timeout so handoffs are cheaper

Today the stage runs until 120s wall-clock then throws. With parallelism the worker-handoff is rarely needed, but when it is:

**Edit `discipline-review.ts`:**
- Drop `STAGE_SOFT_TIMEOUT_MS` from `120_000` → `90_000`. Combined with parallel chunks this leaves ample headroom and avoids the 90-150s "almost done but rebooting" window the user just saw.
- After the timeout throw, the dispatcher already re-invokes; checkpoint state lets it resume in ~2s.

## Out of scope (intentionally)

- **Switching to a faster model** — `gemini-2.5-flash` is already the right choice for vision-heavy chunked work. Pro would be slower per call.
- **Pre-warming Gemini** — no measurable benefit; cold starts are server-side at the gateway.
- **Reducing chunk size** — smaller chunks = more API calls = more cost & no net speedup.

## Files touched

- `supabase/functions/run-review-pipeline/stages/discipline-review.ts` (progress writes, parallel chunks, timeout)
- `src/components/plan-review/PipelineProgressStepper.tsx` (sub-line + watchdog text)
- (No DB migration — `ai_run_progress` is already a flexible JSONB column.)

## Expected outcome

- Architectural-heavy reviews (~70 sheets): **discipline_review drops from ~100-150s to ~30-50s.**
- Even when Gemini has a slow chunk, the UI shows live chunk progress so it never looks frozen.
- Worker handoffs become rare; when they happen they're transparent (resume from saved chunk).
