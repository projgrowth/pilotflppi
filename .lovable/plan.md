# Codebase Audit & Cleanup Plan

Goal: shrink surface area, eliminate dead code, and split a few mega-files so future edits are safer and faster. The codebase is in good shape overall (no `console.log` spam, only 1 `as any`, only 1 `TODO`), so this is targeted cleanup rather than a rewrite.

---

## A. Dead code to delete (truly orphaned, zero imports)

These files are not referenced anywhere in `src/` or routes:

| File | Notes |
|---|---|
| `src/components/ScanTimeline.tsx` | Old timeline visualization — replaced by `PipelineProgressStepper` |
| `src/components/plan-review/RoundDiffPanel.tsx` | Round-diff UI not wired into ReviewDashboard |
| `src/components/shared/SkeletonRow.tsx` | Replaced by shadcn `<Skeleton>` |
| `src/hooks/plan-review/useReviewActions.ts` | Logic was inlined into `useReviewDashboard` |
| `src/hooks/useCountUp.ts` | Animated counter hook, never used |
| `src/hooks/useUserRole.ts` | Role check happens server-side via RLS now |

Estimated removal: ~6 files, ~600 lines.

## B. Orphaned components to wire up (just built, never mounted)

These were created last loop for Track 3 but never imported. Decision needed:

| File | Action |
|---|---|
| `src/components/plan-review/LetterReadinessGate.tsx` | **Wire into** `CommentLetterExport.tsx` above the export button |
| `src/components/plan-review/LetterSnapshotViewer.tsx` | **Wire into** `ReviewDashboard.tsx` as a "History" tab |
| `src/lib/send-letter-snapshot.ts` | **Call from** the "Mark Sent" handler in `ReviewDashboard` |

Without wiring, Track 3 delivers zero user value.

## C. Unused shadcn UI primitives (each used in only 1 file = self)

`accordion`, `command`, `form`, `resizable`, `scroll-area`, `table` — all show 1 hit (the file itself). Safe to delete:

- `src/components/ui/accordion.tsx`
- `src/components/ui/command.tsx`
- `src/components/ui/form.tsx`
- `src/components/ui/resizable.tsx`
- `src/components/ui/scroll-area.tsx`
- `src/components/ui/table.tsx`

(Keep `sonner` — it's mounted in `App.tsx` via the Toaster.)

Removes ~6 files and lets us prune deps: `@radix-ui/react-accordion`, `@radix-ui/react-scroll-area`, `cmdk`, `react-resizable-panels`, `react-hook-form` (verify no other consumers first).

## D. Mega-file splits (high-impact)

### 1. `supabase/functions/run-review-pipeline/index.ts` — **4,206 lines**
Already has clean `// ----- section -----` markers. Split into siblings imported by `index.ts`:

```text
run-review-pipeline/
  index.ts                  (handler + scheduleNextStage, ~400 lines)
  _shared/cost.ts           (withCostCtx, recordCostMetric, callAI)
  _shared/manifest.ts       (readSignedManifest, signedSheetUrls)
  stages/upload.ts          (stageUpload, stagePreparePages, stageSheetMap)
  stages/submittal.ts       (stageSubmittalCheck)
  stages/dna.ts             (stageDnaExtract, evaluateDnaHealth, stageDnaReevaluate)
  stages/discipline.ts      (stageDisciplineReview, runDisciplineChecks)
  stages/cross-check.ts     (runCrossSheetConsistency, stageCrossCheck)
  stages/dedupe.ts          (jaccard, stageDedupe)
  stages/citations.ts       (stageGroundCitations)
  stages/evidence.ts        (attachEvidenceCrops)
  stages/verify.ts          (stageVerify)
  stages/finalize.ts        (stageDeferredScope, stagePrioritize, stageComplete)
```
Pure refactor — no logic changes, no behavior change. Deno bundles siblings fine.

### 2. `src/pages/PlanReviewDetail.tsx` — **1,009 lines**
Extract sub-components into `src/components/plan-review-detail/`:
- `UploadSection.tsx`
- `ProcessingSection.tsx`
- `ResultsSection.tsx`
- `useReviewPolling.ts` (hook)

Target: page file under 300 lines.

### 3. `src/components/NewPlanReviewWizard.tsx` — **1,007 lines**
Each step into its own file:
- `wizard/StepProjectInfo.tsx`
- `wizard/StepUpload.tsx`
- `wizard/StepReview.tsx`
- `wizard/wizard-constants.ts` (counties, trades, services arrays)
- `wizard/useWizardState.ts`

### 4. `src/lib/county-report.ts` (521) and `src/lib/county-requirements/data.ts` (480)
Move large static county arrays into JSON under `src/data/counties/` and import — keeps diffable code small and lets Vite tree-shake.

## E. Quick wins

- Remove the 2 stray `console.log`s in `PlanReviewDetail.tsx` and `NewPlanReviewWizard.tsx`.
- Resolve the lone `TODO` in `src/lib/letter-linter.ts`.
- Replace the 1 `as any` (per project memory: strict TS, no `as any`).

---

## Execution order (proposed)

1. **Delete dead code (A + C)** — instant win, lowest risk.
2. **Wire Track 3 components (B)** — unblocks shipped work.
3. **Split `run-review-pipeline` (D1)** — biggest maintainability win, isolated to one edge function.
4. **Split wizard + detail page (D2 + D3)** — improves preview hot-reload time.
5. **Externalize county data (D4)** — last, smallest payoff.
6. **Quick wins (E)** — bundle into the same PR as #1.

## Expected impact

- ~12 files deleted, ~5 deps removable
- Largest source file drops from 4,206 → ~600 lines
- 3 orphaned Track 3 features become live
- Bundle size: minor (most dead code already tree-shaken), but DX and review speed improve materially

## What this plan does NOT do

- No behavior changes, no schema changes, no new features
- No tests added (none exist today; would be a separate proposal)
- No edge function logic rewrites — splits are mechanical moves only

**Approve and I'll execute steps 1–2 first (lowest risk, highest signal), then check in before tackling the pipeline split.**
