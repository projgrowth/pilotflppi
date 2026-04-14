

# Plan: Address All 5 Audit Improvements

## Summary
Fix the 5 remaining improvement areas: AI edge function security (already done — verify client-side), loading/error/empty states, mobile-responsive plan review, search/filters on Projects, and type safety cleanup.

---

## 1. Verify AI Edge Function Security (Already Secured)
The edge function already has JWT validation via `getClaims()` (lines 367-387). The client `streamAI()` already sends the session access token. **No code changes needed** — this item is resolved.

## 2. Add Loading, Error, and Empty States

**Files**: `Analytics.tsx`, `Inspections.tsx`, `Contractors.tsx`, `Documents.tsx`, `DocumentsGen.tsx`

- Wrap data-dependent sections with loading skeleton fallbacks using the existing `Skeleton` and `SkeletonRow` components
- Add error state handling: if queries fail, show a centered error message with retry button
- Analytics: guard charts with `isLoading` from `useProjects()` — show skeleton cards while loading
- Inspections: already has `EmptyState` but no loading skeleton — add one
- Contractors: already has loading/empty — verify error handling

## 3. Make PlanReviewDetail Mobile-Responsive

**File**: `PlanReviewDetail.tsx`

- The page uses `ResizablePanelGroup direction="horizontal"` which doesn't work on mobile
- On screens < 768px: replace the resizable two-panel layout with a vertical stack + tab switcher (Plan Sheet | Findings)
- Use the existing `use-mobile` hook to detect mobile
- Hide the resizable handle on mobile; show a tab bar at the top instead
- Ensure the findings accordion is scrollable on small screens

## 4. Add Search, County Filter, and Sort to Projects

**File**: `Projects.tsx`

The page already has search and status filter pills. Add:
- **County dropdown filter** next to the existing filter pills — `Select` with "All Counties" default + the FLORIDA_COUNTIES list
- **Sort toggle** (newest first / deadline soonest) — small dropdown or toggle button
- Update the `filtered` logic to include county filter
- These are lightweight additions to the existing filter bar

## 5. Fix `as any` Type Casts

**Files**: `useInvoices.ts`, `useReviewData.ts`, `ReviewDetail.tsx`, `ProjectDetail.tsx`, `Settings.tsx`, `FbcCountyChatbot.tsx`, `FeeScheduleSettings.tsx`

Key patterns to fix:
- **`supabase.from("invoices" as any)`**: The `invoices` table exists in the DB but may not be in the generated types. Run a types regeneration or add manual type overrides in a `database.types.ts` extension file
- **Severity/confidence badge casts**: Define proper union types for severity (`"critical" | "major" | "minor"`) and confidence (`"verified" | "likely" | "advisory"`) and use type guards
- **`status: newStatus as any`** in ProjectDetail: use the `project_status` enum type from Supabase types
- **`jurisdictions as any`** in Settings: cast to `Json` type from Supabase types
- **`output_id: null as any`** in ReviewDetail: make the field nullable in the insert type or use a proper default

---

## Execution Order
1. Loading/error/empty states (broadest UX impact)
2. Projects search & filter enhancements
3. PlanReviewDetail mobile layout
4. Type safety fixes
5. Mark AI security as resolved

## Files Modified
- `src/pages/Analytics.tsx`
- `src/pages/Inspections.tsx`
- `src/pages/Projects.tsx`
- `src/pages/PlanReviewDetail.tsx`
- `src/hooks/useInvoices.ts`
- `src/hooks/useReviewData.ts`
- `src/pages/ReviewDetail.tsx`
- `src/pages/ProjectDetail.tsx`
- `src/pages/Settings.tsx`
- `src/components/FbcCountyChatbot.tsx`
- `src/components/FeeScheduleSettings.tsx`

