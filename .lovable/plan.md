

# Fix: mobile re-analyze crashes the page

## Root cause

`PipelineProgressStepper` calls `onComplete` **inside the render body** with no guard:

```tsx
// PipelineProgressStepper.tsx, lines 105-109
const completeRow = byStage.get(terminalKey);
if (completeRow?.status === "complete" && onComplete) {
  queueMicrotask(onComplete);            // ← fires on EVERY render
}
```

The parent's `onComplete` (`handlePipelineComplete` in `PlanReviewDetail.tsx`) calls `queryClient.invalidateQueries(...)` plus three `setState`s. That invalidation triggers a refetch of `pipeline_status` → realtime subscription also fires invalidations → stepper re-renders → microtask schedules `onComplete` again → infinite loop. Plus `setAiRunning(false)` closes the popover, but the next render re-opens it because the parent flips state again.

On desktop the loop is fast enough you barely notice (state stabilizes once everything fully settles). On mobile, the lower memory + the popover overlay + the auto-retry `useEffect` competing in the same loop crash the tab and React resets the route. That's the "page reset" the user sees.

A second, smaller bug compounds it: clicking **Re-Analyze** when a previous run already finished (`completeRow.status === "complete"`) instantly fires `onComplete` before the new run has even started, flipping `aiRunning` back to `false` and closing the popover before the UI ever shows progress.

## Fix

### 1. `src/components/plan-review/PipelineProgressStepper.tsx`
Move the `onComplete` firing out of render into a `useEffect`, gate it with a ref so it fires **once per pipeline-completion transition** (not once per render), and reset the latch when the terminal stage leaves `complete` (so a new run can fire it again).

```tsx
const firedForRef = useRef<string | null>(null);
useEffect(() => {
  const row = byStage.get(terminalKey);
  const key = row?.started_at ?? null;
  if (row?.status === "complete" && onComplete && firedForRef.current !== key) {
    firedForRef.current = key;
    onComplete();
  }
  if (row?.status !== "complete") firedForRef.current = null;
}, [byStage, terminalKey, onComplete]);
```

Remove the render-body `if (completeRow?.status === "complete" && onComplete) queueMicrotask(onComplete)`.

### 2. `src/pages/PlanReviewDetail.tsx` — `runAICheck`
Defensive: clear the previous terminal-stage `complete` row from the cache before invoking the pipeline so the freshly-mounted stepper doesn't immediately see stale "complete" state for the prior run.

```tsx
const runAICheck = async () => {
  if (!review || aiRunning) return;
  setAiRunning(true);
  setAiCompleteFlash(null);
  // Drop any cached terminal-stage status so the popover shows progress, not stale "complete".
  queryClient.removeQueries({ queryKey: ["pipeline_status", review.id] });
  try { /* …existing invoke… */ }
};
```

### 3. `src/components/plan-review/ReviewTopBar.tsx` — mobile popover
On a 587px viewport the `w-80` popover is fine, but `<Popover open>` (uncontrolled-forced-open) means tapping outside can't dismiss it, and any state thrash above keeps it tied to render. Make the popover **controlled** by `aiRunning` and add `onOpenChange` so the user can close it manually:

```tsx
<Popover open={aiRunning} onOpenChange={(v) => { /* allow user-close, no state change */ }}>
```
Plus `modal={false}` so it doesn't trap focus on mobile (which on small screens can also feel like "the page died").

### 4. `src/pages/PlanReviewDetail.tsx` — `handlePipelineComplete` resilience
Even after fix #1, make this handler idempotent so any future regressions don't loop:

```tsx
const handlePipelineComplete = useCallback(() => {
  if (!aiRunning) return;                  // already handled
  queryClient.invalidateQueries({ queryKey: ["plan-review-findings-v2", review?.id] });
  queryClient.invalidateQueries({ queryKey: ["plan-review", id] });
  setAiRunning(false);
  setAiCompleteFlash(findings.length);
  setTimeout(() => setAiCompleteFlash(null), 3000);
}, [aiRunning, queryClient, review?.id, id, findings.length]);
```

## Files changed

```text
EDIT
  src/components/plan-review/PipelineProgressStepper.tsx
    • Replace render-body queueMicrotask with useEffect + ref latch keyed on started_at
  src/pages/PlanReviewDetail.tsx
    • runAICheck: remove stale pipeline_status cache before invoking
    • handlePipelineComplete: wrap in useCallback, no-op when not running
  src/components/plan-review/ReviewTopBar.tsx
    • Popover: controlled open, modal={false}, onOpenChange wired
```

## Verification

- On mobile (587×904): tap Re-Analyze on a completed review → popover opens, stepper shows progress, no crash, no route reset.
- After a real new run completes: `aiCompleteFlash` flashes once, popover closes, findings refresh — no double-fire.
- Tap outside the popover mid-run on mobile → popover dismisses; pipeline keeps running in background; reopening is a normal action.
- Desktop behavior unchanged: same single completion event, no extra invalidations.

