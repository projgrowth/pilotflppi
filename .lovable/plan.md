

## Why the latest upload pulled nothing

I traced the failing run (`26b31242…`) end-to-end:

1. `upload` stage finished cleanly at 14:03:29.
2. `prepare_pages` started at 14:03:40 and is **still `running` 11 minutes later** with only **1 page** in the manifest.
3. The edge function logs show one `booted` event at 14:03:24 and then nothing — the worker died on the CPU limit mid-rasterization and never came back.
4. Because `prepare_pages` is "fatal" in the dispatcher, the rest of the chain (`sheet_map`, `dna_extract`, `discipline_review`, `dedupe`) never ran. No DNA, no findings, nothing for the dashboard to show.

### Root cause

The current `prepare_pages` design has two problems pulling against each other:

1. **The "crash-resilient pre-schedule"** fires a *recovery* `prepare_pages` worker ~0s **before** the current worker starts rasterizing. Both workers race on chunk 0 of the same PDF:
   - Both download the same 50-MB PDF.
   - Both cold-load MuPDF WASM (~1.5s of pure CPU each).
   - Both target page 0 (cold-start budget = 1 page).
   - At least one dies on CPU before writing its manifest row.
   - Neither worker ever schedules a **third** worker, because the recovery was pre-scheduled before the work even started — there's no recovery-for-the-recovery.

2. **`PREPARE_STALE_RUNNING_MS = 60_000` is defined but never read.** Nothing in the dispatcher actually takes over a stuck `running` row.

Net effect: one CPU-kill on the very first chunk strands the whole pipeline. That's exactly what's in the database right now.

This upload also went through the inline drop-zone (`PlanViewerPanel`), not the wizard, so the browser-side pre-rasterization that normally avoids server MuPDF was skipped — which is why the worker had to do the heaviest possible work (cold MuPDF + render + upload) on its own.

## The fix — strip prepare_pages down to one honest path

### A. Edge function (`supabase/functions/run-review-pipeline/index.ts`)

**Remove the racing recovery pre-schedule.** Each `prepare_pages` worker:

1. Checks cancellation.
2. Marks the stage `running` with `started_at = now()`.
3. Rasterizes exactly **one** chunk (current `RASTERIZE_CHUNK_COLD_START = 1` first time, `RASTERIZE_CHUNK = 2` after).
4. **Only after** the chunk's manifest rows are committed:
   - If more chunks remain → schedule **one** next `prepare_pages` worker, leave row in `running` with updated `metadata.prepared_pages`.
   - If done → mark `complete` and schedule `sheet_map`.
5. If the worker throws, the row is left as-is (still `running`).

**Add a real stale-row takeover** in the dispatcher entry path. When a `prepare_pages` invocation arrives and the existing row is `running` with `updated_at` older than `PREPARE_STALE_RUNNING_MS` (60s), treat it as dead and proceed — same chunk-of-one logic.

**Add a single `prepare_pages` watchdog** at the top of every dispatcher invocation (cheap one-row query): if the review's `prepare_pages` row has been `running` >60s with no updated_at change AND the current call is for any other stage, redirect to `prepare_pages` to resume. This guarantees that even an orphaned upload eventually gets revived the next time anything pokes the function (cancel, manual re-run, even another review's call into the function — no, actually scoped per planReviewId so only its own invocations revive it).

**Stop classifying `prepare_pages` as fatal-on-error.** Instead, on a thrown error inside `runOneStage` for `prepare_pages`:
   - If the manifest already has ≥1 ready page, mark the row `running` (not `error`) and re-schedule a single follow-up worker with a 2s delay. CPU-kills look like throws or worker death; both should auto-resume up to a small bounded number of times (track an attempt counter in `metadata.prepare_attempts`, cap at 8). After 8 attempts → mark `error` so the user is told plainly.

### B. Front-end safety net

**`PlanViewerPanel` upload path** currently bypasses the wizard's browser-side rasterization. After the file finishes uploading and a plan_review row exists, kick off a lightweight browser-side rasterization (the same code the wizard uses) before invoking `run-review-pipeline`. When the user drops a file inline, they get the same fast path the wizard does.

If browser rasterization isn't available (no `window`, very large PDF), fall through to the edge function — but the edge function's chunked + watchdog loop will now actually finish.

### C. Cleanup of the current zombie

The dashboard's "Pipeline Activity" page already has a "Resume" button. With the takeover logic above, clicking Resume on `26b31242…` will pick up at page 1 of the PDF and finish the prepare → sheet_map → dna → discipline → dedupe chain. No manual DB surgery needed.

### Files changed

- `supabase/functions/run-review-pipeline/index.ts` — remove pre-schedule race; add stale-row takeover; add per-review watchdog; bounded retry on prepare error; honest `metadata.prepare_attempts`.
- `src/components/PlanViewerPanel.tsx` — wire browser-side pre-rasterization before invoking the pipeline (mirroring `NewPlanReviewWizard.tsx` lines around `pageAssetRows`).
- `src/components/NewPlanReviewWizard.tsx` — extract its rasterize-and-upload-page-assets helper into `src/lib/pdf-utils.ts` (or a sibling) so the inline drop-zone can reuse it.

### Outcome

- One worker per chunk, no racing.
- Stuck `running` rows get revived automatically within 60s of the next invocation.
- Inline drag-drop uploads use the same browser-side pre-rasterization the wizard does, so the edge function's `prepare_pages` becomes a fast no-op for most uploads.
- The current stuck review can be revived with one Resume click.

