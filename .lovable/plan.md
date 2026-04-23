

# Plan Review Audit — Cleanup & Improvements

A focused audit of the entire plan-review surface (edge function, hooks, pages, helpers). Below is what's wrong, why it matters, and what to change. Grouped by impact.

## Snapshot of what's there today

```text
EDGE   supabase/functions/run-review-pipeline/index.ts ........ 3,526 lines (one file)
PAGES  PlanReviewDetail.tsx ......... 893    ReviewDashboard.tsx ... 306
       PipelineActivity.tsx ......... 409    NewPlanReviewWizard.tsx 969
HOOKS  useReviewDashboard.ts ........ 458    useAllActivePipelines.. 166
       usePlanReviewData.ts ......... 110    pipeline-cancel.ts .... 119
LIB    pdf-utils.ts ................. 513
DB     14 reviews, 85 v2 deficiencies, 8 active correction patterns,
       8 reviews with pipeline rows. Last 7 days: 5 prepare_pages errors,
       7 sheet_map errors, 7 dedupe errors — high failure rate.
```

## P0 — Bugs that break the experience

### 1. Realtime channel collision on Pipeline Activity
The runtime error you're seeing right now is from `useAllActivePipelines.ts`. When `firmId` is `null` the channel name resolves to `pipeline-activity-all-00000000-…-001` and the hook still subscribes — but every component mount re-attaches `.on("postgres_changes", …)` to that same name *after* `subscribe()`, which Supabase Realtime forbids.

Fix: route this hook through the existing `subscribeShared` registry in `useReviewDashboard.ts` (it ref-counts subscribers per topic) and short-circuit when `firmId` is `null`. One line change in the hook plus deleting the local channel block.

### 2. Pipeline failure rate is ~50%
DB shows the chain breaks most often at `sheet_map` (7 errors) and `dedupe` (7 errors) — but only `prepare_pages` has retry logic. A single transient AI gateway hiccup at `sheet_map` strands the whole review. Generalize the bounded-retry pattern (currently only on `prepare_pages`) into a small helper so every non-fatal stage gets ≤3 attempts before marking `error`.

### 3. Inline drop-zone bypasses error handling
In `PlanReviewDetail.handleFileUpload` (line 254), `supabase.functions.invoke("run-review-pipeline", …)` is wrapped in a `try/catch` that only `console.warn`s. When the invoke 401s or the user has no firm, the user sees "Uploaded" but the pipeline never starts and there's no surfaced error. Surface failures with a toast and add a retry CTA.

## P1 — Architecture cleanup

### 4. The 3,526-line edge function is the single biggest risk
`supabase/functions/run-review-pipeline/index.ts` is a monolith that mixes: AI gateway client, MuPDF rasterization, manifest IO, 11 stage implementations, citation grounding, dedupe math, dispatcher, watchdog, and HTTP handler. It works, but no human can hold it in their head, and the retry/cancel/watchdog logic is scattered. Split into siblings — Supabase Edge supports module imports from `index.ts` (you already do this for `discipline-experts.ts`):

```text
supabase/functions/run-review-pipeline/
├── index.ts                  ← HTTP handler + dispatcher + watchdog only (~300 lines)
├── stages/
│   ├── upload.ts
│   ├── prepare-pages.ts      ← rasterization, chunk loop, retry counter
│   ├── sheet-map.ts
│   ├── dna-extract.ts
│   ├── discipline-review.ts
│   ├── verify.ts
│   ├── dedupe.ts
│   ├── ground-citations.ts
│   ├── cross-check.ts
│   ├── deferred-scope.ts
│   ├── prioritize.ts
│   └── complete.ts
├── lib/
│   ├── ai-gateway.ts         ← callAI, withRetry, error classes
│   ├── manifest.ts           ← signedSheetUrls + page asset helpers
│   ├── mupdf.ts              ← rasterizePdfStreaming, raster constants
│   ├── stage-status.ts       ← setStage, isCancelled, runWithRetry
│   └── types.ts              ← Stage, PipelineMode, schemas
└── discipline-experts.ts     ← already split
```

This lands in stages — start by moving the AI gateway, MuPDF, and `setStage`/`isCancelled` helpers out (they're pure). Stage extraction follows.

### 5. Pages doing direct DB writes
`PlanReviewDetail.handleFileUpload` is 120+ lines that talks to four tables and Storage and the edge function inline. `ReviewDashboard.runPipeline` writes `ai_run_progress` directly. This is exactly the same mistake `pipeline-cancel.ts` already solved for cancel — extract:

- `src/lib/plan-review-upload.ts` — `uploadPlanReviewFiles({ reviewId, files, firmId, userId })` returning `{ acceptedCount, pageAssetCount, pipelineKicked }`. Owns: file validation, Storage upload, browser pre-rasterization, `plan_review_files` insert, page-asset upsert, pipeline invoke. The page becomes a 5-line call.
- `src/lib/pipeline-run.ts` — `startPipeline(reviewId, mode)` (clears `cancelled_at`, invokes edge fn, returns toast-friendly result). Used by both `ReviewDashboard` and `NewPlanReviewWizard`.

### 6. Two parallel "render PDF" paths
`pdf-utils.ts` has both legacy `renderPDFPagesToImages` (PNG, blocking) and the newer `rasterizeAndUploadPages` (JPEG, streaming). The viewer uses the legacy one through `usePdfPageRender`. Standardize on JPEG/streaming, delete the PNG path. Saves ~120 lines and removes a branch where canvas memory leaks.

### 7. Stage list defined in three places
`CORE_STAGES`/`DEEP_STAGES` exist in `run-review-pipeline/index.ts` (Stage enum), `useReviewDashboard.ts` (PIPELINE_STAGES), and `PipelineActivity.tsx` (local copies). They've already drifted (PipelineActivity has its own copy). Consolidate to `src/lib/pipeline-stages.ts` shared by client; keep the Deno copy in `lib/types.ts` of the edge function with a comment that the two must match.

## P2 — Quality & polish

### 8. Cancel/Resume helpers should also clear stuck "running" rows
`resumePipelineForReview` only resets the row matching the passed stage. If the user clicks Resume on a `discipline_review` row but `prepare_pages` is also stuck `running`, the watchdog redirect fires once and then loops. Resume should reset every `running`/`pending` row to `pending` for that review before invoking.

### 9. Pipeline Activity shows orphan count but UI doesn't explain why
The "N orphaned pending row(s)" badge appears with a Clear button, but there's no tooltip explaining what an orphan is. Add a one-line popover: "Pending stages older than 10 minutes that never started — usually from a worker that crashed before claiming the row."

### 10. `useAllActivePipelines` polls every 5s AND subscribes to realtime
Pick one. Realtime is reliable for `review_pipeline_status` (you've used it elsewhere) — drop the `refetchInterval: 5_000` and rely on the subscription. Cuts ~12 unnecessary requests per minute per open tab.

### 11. Missing index on the hot query
`useAllActivePipelines` runs `select * from review_pipeline_status where started_at > now() - interval '24h' or status in ('running','pending')` on every fetch. Add a partial index:
```sql
CREATE INDEX idx_pipeline_active ON review_pipeline_status (firm_id, updated_at DESC)
WHERE status IN ('running','pending');
```

### 12. `console.error/warn` left in production paths
`PlanReviewDetail` line 214/258, edge function dozens. Per project memory rules ("No console.logs in production"). Wrap with a tiny `logger` that no-ops in `import.meta.env.PROD` for the client; for the edge function keep `console.error` (Supabase Logs) but remove the `console.log` "[watchdog]" / "[schedule]" noise once stable.

### 13. `as any` / `as unknown as any` in the edge function
9 occurrences. The `createClient` cast at the top is fine (Supabase client typings don't ship to Deno), but the rest are around row reads — replace with small typed local interfaces (`type PipelineRow = { status: string; updated_at: string; metadata: Record<string, unknown> | null }`) so the row shapes are documented in code.

### 14. Hidden state in `PlanReviewDetail`
The page owns 18 `useState` declarations and three `useRef`s. The filter group (`statusFilter`, `confidenceFilter`, `disciplineFilter`, `sheetFilter`) belongs in a small `useFilterState` reducer so the URL can serialize/restore them later (right now reloading loses all filters).

## What this looks like after, in numbers

```text
Edge function ........ 3,526 → ~300 dispatcher + 10 stage files (~150–250 each)
PlanReviewDetail ..... 893   → ~600 (upload extracted, filter state hooked)
useAllActivePipelines  166   → ~80  (shared subscription, no polling)
pdf-utils ............ 513   → ~370 (PNG path removed)
Pipeline failure rate. ~50%  → expected <10% with retries on every stage
Realtime errors ...... 1     → 0
```

## Suggested order of execution

1. **P0 fixes** — realtime collision, generalized retry, surfaced upload errors. (1 commit, low risk, immediate UX win.)
2. **Helper extraction** — `plan-review-upload.ts`, `pipeline-run.ts`, `pipeline-stages.ts`. (Pure refactor, no behavior change.)
3. **PDF path consolidation** — drop PNG renderer.
4. **Edge function modularization** — start with `lib/` (pure helpers), then peel stages one at a time. Each PR independently deployable since each stage is invoked individually anyway.
5. **DB index + drop poll interval** — small, measurable.
6. **Polish** — `as any` cleanup, console hygiene, filter URL state.

No DB schema changes are required for any of this except the optional partial index in P2 #11. No edge function contract changes — the `{ plan_review_id, stage?, mode? }` body and `202` response stay identical, so no other callers need updating.

