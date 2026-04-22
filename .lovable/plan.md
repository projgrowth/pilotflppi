

# Fix LintDialog props in PlanReviewDetail

One-line build fix.

## Problem

`PlanReviewDetail.tsx:765` passes `onProceed` to `<LetterLintDialog>`, but the component's `Props` interface declares `onConfirmSend` and also requires a `blocked` boolean.

## Change

In `src/pages/PlanReviewDetail.tsx` around line 760–766, update the JSX:

```tsx
<LetterLintDialog
  open={lintDialogOpen}
  onOpenChange={setLintDialogOpen}
  issues={lintIssues}
  blocked={hasBlockingIssues(lintIssues)}
  onConfirmSend={handleConfirmedSend}
/>
```

- Add `blocked={hasBlockingIssues(lintIssues)}` — import `hasBlockingIssues` from `@/lib/letter-linter` if not already imported.
- Rename `onProceed` → `onConfirmSend` (point at the same handler currently wired, e.g. `handleConfirmedSend`).

## Verification

- `npx tsc --noEmit` passes.
- Send-letter flow unchanged: lint runs → if errors, dialog shows Close only; if warnings only, "Send anyway" calls the same handler as before.

## Files

**Modified**
- `src/pages/PlanReviewDetail.tsx` (one JSX block + possibly one import line)

