

# Audit & Cleanup — Wire-Up Verification + Dead Code Removal

After the dashboard overhaul shipped, several components became orphaned, the unified shortcut contract was created but never adopted, and the workspace still has the `R`-key collision the plan was supposed to eliminate. Here's the surgical cleanup.

## What's wired correctly

- `ReviewDashboard` → `DashboardAlertStack`, `NextStepBar`, `FilterChips`, `AuditCoveragePanel`, `TriageInbox` ✅
- `useFilteredDeficiencies` chip filter is plumbed from page → list ✅
- `DeficiencyCard` collapse-when-inactive is honored by `DeficiencyList` and `TriageInbox` (both pass `isActive`) ✅
- `recordPatternConfirmation` confirmed wired into `DeficiencyActions` confirm path ✅
- `usePipelineErrorStream` + `reprepareInBrowser` recovery flow wired ✅

## What's broken or orphaned

### 1. Orphaned components (no remaining importers)

```text
src/components/review-dashboard/HumanReviewQueue.tsx       — DELETE
src/components/review-dashboard/DeferredScopePanel.tsx     — DELETE
src/components/review-dashboard/CitationDbBanner.tsx       — DELETE
src/components/review-dashboard/LetterQualityGate.tsx      — DELETE
src/components/plan-review/KeyboardShortcutsOverlay.tsx    — DELETE
```

Verified via grep: zero `import` sites for each. They were the four banners + queue surfaces collapsed into `DashboardAlertStack` and the chip-filter view, plus a workspace overlay that has no caller.

### 2. `DnaHealthBanner` — extract the constant, drop the component

`ReviewDashboard` still imports `CRITICAL_DNA_FIELDS` from `DnaHealthBanner.tsx` but the banner component itself is unused. Move `CRITICAL_DNA_FIELDS` into a tiny `src/lib/dna-fields.ts` and delete `DnaHealthBanner.tsx`.

### 3. Unused option in `useFilteredDeficiencies`

`onlyHumanReview` was used by the now-deleted `HumanReviewQueue`. Drop the option, the branch in the filter, and the `humanReview` count return field (no remaining consumers — chip filter `needs-eyes` does the same job).

### 4. Unified keyboard contract was created but never adopted

`src/lib/review-shortcuts.ts` exists and exports `REVIEW_SHORTCUTS`, `isTypingTarget`, `isRejectShortcut` — but nothing imports it. Both keyboard handlers still hard-code their own maps:

| Surface | Current behavior | Problem |
|---|---|---|
| `useTriageController` (dashboard) | bare `R` → reject | per the plan, must be `Shift+R` |
| `PlanReviewDetail` (workspace) | bare `R` → reposition pin | per the plan, drop entirely (toasts an error in v2) |
| `TriageShortcutsOverlay` legend | shows `R` for reject | stale, misleads users |

Fixes:
- `useTriageController.ts` line 174: replace `k === "r"` branch with `isRejectShortcut(e)`.
- `PlanReviewDetail.tsx` lines 337-343: delete the `case "r"` reposition branch and the now-unused `setRepositioningIndex` call from this handler. Also delete the `case "x"` (deferred) and `case "o"` (open) blocks — they have no equivalent in the unified contract and only exist on this page.
- `TriageShortcutsOverlay.tsx`: rebuild the legend from `REVIEW_SHORTCUTS` so the displayed map is the source-of-truth map (replaces the hard-coded `SHORTCUTS` array).
- `PlanReviewDetail.tsx` keyboard handler: replace inline `isTyping` check with `isTypingTarget(e.target)` for consistency.

### 5. Stale state in `PlanReviewDetail`

With the workspace `KeyboardShortcutsOverlay` removed, drop `showShortcuts`/`setShowShortcuts` state (lines 138, 365-376) and the `?`/`Escape` cases in the workspace handler. Workspace shortcuts will surface through the dashboard's `TriageShortcutsOverlay` after the merge — the workspace doesn't need its own.

### 6. `animate-pulse` on the Run AI button

`ReviewTopBar.tsx` line 51 still pulses the "Run AI Check" button when there are no findings. Per project memory ("Use static accent borders for urgent notifications, never animations"), replace `animate-pulse` with a static `border border-primary/60 ring-1 ring-primary/20`.

### 7. `ReviewerMemoryCard` duplication note (verify only)

The plan called for removing the duplicate `ReviewerMemoryCard` from `ReviewDashboard`. Confirmed: `ReviewDashboard.tsx` no longer imports it directly — it's only rendered inside the Memory chip popover in `ReviewHealthStrip`. ✅ No action needed.

---

## Files changed

```text
DELETE
  src/components/review-dashboard/HumanReviewQueue.tsx
  src/components/review-dashboard/DeferredScopePanel.tsx
  src/components/review-dashboard/CitationDbBanner.tsx
  src/components/review-dashboard/LetterQualityGate.tsx
  src/components/review-dashboard/DnaHealthBanner.tsx
  src/components/plan-review/KeyboardShortcutsOverlay.tsx

CREATE
  src/lib/dna-fields.ts             // 1 export: CRITICAL_DNA_FIELDS

EDIT
  src/pages/ReviewDashboard.tsx     // import CRITICAL_DNA_FIELDS from new path
  src/hooks/useFilteredDeficiencies.ts
                                    // drop onlyHumanReview branch + humanReview count
  src/hooks/useTriageController.ts  // bare R → isRejectShortcut(e); use isTypingTarget
  src/components/review-dashboard/TriageShortcutsOverlay.tsx
                                    // render from REVIEW_SHORTCUTS
  src/pages/PlanReviewDetail.tsx    // delete R/X/O/?/Escape branches + showShortcuts state
                                    // use isTypingTarget for consistency
  src/components/plan-review/ReviewTopBar.tsx
                                    // animate-pulse → static accent border
```

## Verification after edits

- `grep -r "HumanReviewQueue\|DeferredScopePanel\|CitationDbBanner\|LetterQualityGate\|KeyboardShortcutsOverlay\|DnaHealthBanner"` should return zero hits.
- `grep -r "onlyHumanReview"` should return zero hits.
- Both surfaces share `isRejectShortcut` / `isTypingTarget` from `review-shortcuts.ts`.
- `Shift+R` rejects on both pages; bare `R` does nothing on either.
- No `animate-pulse` in `ReviewTopBar.tsx`.

No DB schema changes. No edge function changes. Pure dead-code removal + unification of the keyboard contract that already exists in `review-shortcuts.ts`.

