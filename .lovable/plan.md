

# Collapsible Sidebar (Icon-Only Mode)

## Problem
The sidebar is fixed at 240px with no way to collapse it, eating into workspace area — especially painful on the Plan Review detail page where you want maximum width for plan markup and findings.

## Solution
Add a collapse/expand toggle to the sidebar. When collapsed, it shrinks to ~56px showing only icons (no labels, no section titles, no user details — just the icon strip plus a toggle button). The state persists via `localStorage`.

## Changes

### `src/components/AppSidebar.tsx`
- Add `collapsed` / `setCollapsed` state, initialized from `localStorage`
- Add a collapse toggle button (e.g., `PanelLeftClose` / `PanelLeftOpen` icon) in the sidebar header area
- In `NavSection`: hide section title text and nav label text when collapsed; show only icons centered
- In the branding block: show only a small "FPP" or the icon when collapsed
- In the user chip: show only initials avatar when collapsed
- Hide the `⌘K` search hint text when collapsed
- Sidebar width: `w-[240px]` when expanded, `w-14` when collapsed
- Add tooltips on nav icons when collapsed so users can still see the label on hover

### `src/components/AppLayout.tsx`
- No changes needed — the sidebar already uses `shrink-0` and the main area is `flex-1`, so it will automatically expand when the sidebar shrinks.

## Technical Details
- Width transition: `transition-all duration-200` for smooth animation
- localStorage key: `"sidebar-collapsed"`
- Tooltip: use existing `Tooltip` component from shadcn on each nav icon when collapsed
