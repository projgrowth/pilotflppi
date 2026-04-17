# Codebase Cleanup — Execution Report

## Subagent results

### S1 — DRY / Deduplicate
Main duplication was type definitions (handled in S2). Other repeated helpers (`withRetry`, `getDaysRemaining`) live in 1-2 sites; extracting them would be over-abstraction. **No changes beyond S2.**

### S2 — Shared types — `src/types/index.ts` (NEW)
Consolidated 6 duplicated/shared shapes:
- `ContractorInfo` (was duplicated 3×)
- `ProjectInfo`, `PlanReviewRow` (were duplicated 2×)
- `Finding`, `MarkupData`, `FindingStatus` (now single source; legacy components re-export for backward compatibility)

**Files updated**: `FindingCard.tsx`, `FindingStatusFilter.tsx`, `ContractorHoverCard.tsx`, `plan-review/ReviewTopBar.tsx`, `pages/PlanReviewDetail.tsx`, `pages/PlanReview.tsx`.

### S3 — knip
**Blocked**: knip cannot load `playwright.config.ts` in the sandbox (missing `lovable-agent-playwright-config/config`). Per spec ("do not remove anything that cannot be statically verified"), skipped.

### S4 — madge --circular
**Result: 0 circular dependencies.** Nothing to refactor.

### S5 — Weak types replaced
- `Dashboard.tsx`: `projects: any[]` → `Project[]` (2 locations)
- `Review.tsx`: `daysActive(p: any)` → `{ created_at: string }`
- `QcPendingWidget.tsx`: `ai_findings: any` → `unknown`
- `useAILearningStats.ts`: `c: any` → typed `CorrectionRow`
- `GenerateInvoiceDialog.tsx`: `value: any` → generic `LineItemDraft[K]`
- `ZoningAnalysisPanel.tsx`: `err: any` → `err instanceof Error`
- `LetterPanel.tsx`: `firmSettings: any` → `FirmSettings | null | undefined`

`tsc --noEmit` passes with zero errors.

### S6 — try/catch audit
36 catch blocks reviewed. **All kept** — every block handles async I/O (Supabase calls, fetch, JSON parsing of model output, OAuth redirects) and surfaces user-facing toasts. Three silent-fallback catches retained with new intent comments:
- `AppSidebar.tsx`: localStorage SSR/private-mode guard
- `CommentLetterExport.tsx`: best-effort archive (download still works)
- `PlanReviewDetail.tsx`: JSON salvage from prose-wrapped model output

### S7 — Legacy/fallback removal
Removed narration comments around silent catches; replaced the legacy "If it's a full URL" comment with a tighter one. No dead branches remain.

### S8 — Comments cleanup
Cleaned narration in `PlanReviewDetail.tsx`, `CommentLetterExport.tsx`, `AppSidebar.tsx`, `ZoningAnalysisPanel.tsx`. Surviving comments now explain *why*, not *what*.

## Verification
- `tsc --noEmit`: ✅ 0 errors
- `madge --circular`: ✅ 0 cycles
- All edits stayed within the scope of each subagent
