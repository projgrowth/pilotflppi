

## Swap the topbar's "Run AI Check" spinner for a live stepper

### Current behavior

In the workspace topbar, clicking **Run AI Check / Re-Analyze** just navigates the user away to `/plan-review/:id/dashboard`. There's no inline progress, and the `aiRunning`/`aiCompleteFlash` props on `ReviewTopBar` are wired but never actually flip true (PlanReviewDetail passes `false`/`null` hardcoded). So the button does nothing useful in-place.

### What changes

**1. `ReviewTopBar.tsx`** — when `aiRunning` is true, render an inline popover anchored to the button containing the `PipelineProgressStepper` (compact mode) instead of just spinning. The button itself keeps the spinner label ("Analyzing…") so the topbar height stays stable. Stepper auto-closes the popover when the `complete` stage lands (via `onComplete`) and flashes the existing `aiCompleteFlash` count.

**2. `PlanReviewDetail.tsx`** — replace the `onRunAICheck={openDashboard}` handoff with a real handler:
- Set `aiRunning` to true.
- Invoke the `run-review-pipeline` edge function (`supabase.functions.invoke('run-review-pipeline', { body: { plan_review_id: review.id } })`).
- On invocation success, the realtime stepper (driven by `usePipelineStatus`) takes over surfacing progress.
- Pass `aiRunning` state down so the topbar shows the popover.
- Add an `onPipelineComplete` callback that invalidates the findings query, sets `aiCompleteFlash` to the new findings count for ~3s, and clears `aiRunning`.
- On error, surface a toast and clear `aiRunning`.

**3. Keep the dashboard escape hatch** — add a small "View pipeline dashboard" link inside the popover for power users who still want the full QA view. The big primary action becomes the in-place re-analyze, matching the wizard pattern from the previous request.

### Files touched

- Edit: `src/components/plan-review/ReviewTopBar.tsx` — add Popover wrapping the button; render `PipelineProgressStepper` (compact) when `aiRunning`; accept new `reviewId` and `onPipelineComplete`/`onOpenDashboard` props (reviewId already exists).
- Edit: `src/pages/PlanReviewDetail.tsx` — replace `openDashboard` handoff with real pipeline invocation; manage `aiRunning` / `aiCompleteFlash` state; pass `onOpenDashboard` for the popover link.

### After the change

Click **Re-Analyze** on the workspace topbar → popover drops down with the live stage list (Sheet map → DNA → Discipline review → …) → completes → popover closes, button flashes "✓ N findings", findings panel refreshes — all without leaving the workspace.

