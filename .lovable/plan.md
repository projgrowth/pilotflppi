

# UI/UX Audit & Improvement Plan

## Issues Identified

### 1. Visual Density — Too Cramped
- **Dashboard**: 5 KPI cards + quick actions + QC widget + project table + activity feed all stacked tightly with only `mb-6` gaps. Feels like a wall of data.
- **Project/Plan Review tables**: Column headers use `text-[10px]` — nearly unreadable. Row padding is tight (`py-3.5`).
- **KPI cards**: Small `p-4` padding, values jammed against labels.

### 2. Overdue Banner Animation
- The overdue alert uses `animate-pulse` on the entire banner — distracting and implies loading, not urgency. A static left-border accent or a subtle icon pulse would be better.

### 3. Inconsistent Page Headers
- Dashboard uses a custom greeting instead of `PageHeader`. Deadlines uses a raw `<h1>` without `PageHeader`. Should be unified.

### 4. App.css Residual Styles
- `src/App.css` contains Vite boilerplate (logo spin animations, `max-width: 1280px`, `text-align: center`) that could conflict or confuse. Should be cleaned out.

### 5. Quick Actions Bar Feels Like a Toolbar, Not a Dashboard
- Four buttons in a row with no visual hierarchy. The primary action ("New Intake") doesn't stand out enough from secondary ones.

### 6. Filter Pill Styling Inconsistency
- Projects page uses `bg-muted/50` pill group, Deadlines uses naked buttons with `bg-accent/10`. Should share one pattern.

### 7. Table Column Alignment
- Projects table grid has 8 columns on desktop but list items use `flex` layout — the columns don't actually align with headers.

### 8. Card Borders Everywhere
- Every card has `shadow-subtle border`. With so many cards close together it creates visual noise. Reducing to borderless cards with subtle shadows (or bordered only on hover) would feel cleaner.

### 9. Sidebar: No Visual Cue for Current Section
- The collapsed sidebar shows individual active links but no section grouping indicator.

### 10. Empty States Are Generic
- All empty states look identical (same circle icon pattern). Could benefit from contextual illustrations or at least varied copy.

---

## Proposed Changes (Lean & Minimal)

### A. Increase Whitespace & Breathing Room
- **All pages**: Increase page padding from `p-6 md:p-8` to `p-8 md:p-10`
- **Dashboard**: Increase gaps between sections from `mb-6` to `mb-8`
- **KPI cards**: Increase padding from `p-4` to `p-5`, bump value font from `text-2xl` to `text-3xl`
- **Table rows**: Increase row padding from `py-3.5` to `py-4`, column header text from `text-[10px]` to `text-[11px]`

### B. Clean Up Overdue Banner
- Remove `animate-pulse` from the banner container
- Add a subtle pulse only to the warning icon
- Use a stronger left border accent (`border-l-4 border-l-destructive`)

### C. Unify Page Headers
- Dashboard: Keep greeting but wrap in `PageHeader` component pattern with date as subtitle
- Deadlines: Switch to `PageHeader` component

### D. Remove App.css Boilerplate
- Strip all Vite boilerplate from `src/App.css` (logo spin, max-width, text-align, card padding)

### E. Refine Quick Actions
- Make primary action ("New Intake") larger/more prominent
- Move secondary actions into a more subtle row or dropdown
- Or: style as icon-only buttons with tooltips for a cleaner bar

### F. Standardize Filter Pills
- Create one shared filter pill component used by Projects, Deadlines, and Plan Review pages
- Consistent `bg-muted/50 p-1 rounded-lg` container with `shadow-sm` active state

### G. Soften Card Borders
- Default cards: remove `border`, keep `shadow-subtle`
- Add `border` back on hover for interactive cards
- Section cards (tables): keep one clean border

### H. Table Alignment Fix
- Projects page: ensure list items use `grid` layout matching the header grid template (already partially done but flex fallback on mobile breaks it)

---

## Files Modified

| File | Change |
|------|--------|
| `src/App.css` | Remove all Vite boilerplate |
| `src/index.css` | Increase `--radius` to `0.5rem`, adjust `list-row` padding, add shared filter-pill utility |
| `src/components/KpiCard.tsx` | Increase padding & font size |
| `src/components/PageHeader.tsx` | Minor spacing adjustments |
| `src/pages/Dashboard.tsx` | More whitespace, fix banner animation, refine quick actions layout, use PageHeader pattern |
| `src/pages/Projects.tsx` | Increase spacing, use shared filter pill style, fix grid alignment |
| `src/pages/PlanReview.tsx` | Increase spacing, shared filter pill style |
| `src/pages/Deadlines.tsx` | Use `PageHeader`, shared filter pill, increase spacing |
| `src/pages/Inspections.tsx` | Increase spacing |
| `src/pages/Documents.tsx` | Increase spacing |
| `src/pages/Settings.tsx` | Increase spacing |
| `src/components/QcPendingWidget.tsx` | Softer card styling |

This is a purely cosmetic pass — no logic, data, or routing changes. Every edit increases whitespace, reduces visual noise, and standardizes patterns across pages.
