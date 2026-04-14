

# Design System Audit — Full Report

## Methodology
Scanned all `src/**/*.tsx` files for spacing, color, and typography values. Excluded print-only HTML templates (`CommentLetterExport.tsx`, `CountyDocumentPackage.tsx`, `DocumentsGen.tsx`) from violations — those use inline styles intentionally for PDF/print rendering.

---

## SPACING FINDINGS

### Arbitrary Tailwind Spacing Values Found
| Value | Files | Context |
|-------|-------|---------|
| `pl-[72px]` | `Contractors.tsx` | Expanded sub-row indent |
| `p-[1px]` | `scroll-area.tsx` (UI lib) | Scrollbar padding |
| `mt-[-18px]` | `HorizontalStepper.tsx` | Connector line alignment |

### Card Padding Inconsistency (🔴 High)
Cards use **three different** padding values across the app:
- `p-6` — `Dashboard.tsx` (DashKpi), `card.tsx` defaults
- `p-5` — `KpiCard.tsx`, `Analytics.tsx` cards
- `p-3` — `DisciplineChecklist.tsx`

**Recommendation**: Standardize on `p-5` for compact cards, `p-6` for primary content cards.

### Off-Grid Values (🟡 Medium)
- `pl-[72px]` (Contractors.tsx) — not on 4pt grid (72 is fine, divisible by 4)
- `mt-[-18px]` (HorizontalStepper.tsx) — 18px is off-grid (**violation**)
- `p-[1px]` (scroll-area.tsx) — UI primitive, acceptable

### Most Common Spacing Values (token candidates)
`gap-1`, `gap-1.5`, `gap-2`, `gap-2.5`, `gap-3`, `gap-4`, `p-3`, `p-4`, `p-5`, `p-6`, `px-2`, `px-2.5`, `px-3`, `px-5`, `py-1`, `py-1.5`, `py-2`, `py-2.5`, `py-3`, `py-4`, `mb-2`, `mb-4`, `mt-1`, `mt-2`

All of these are standard Tailwind scale — good.

---

## COLOR FINDINGS

### Hardcoded Colors Bypassing Design System (🔴 High)

**In-app components using `bg-[hsl(...)]` instead of tokens:**
| Pattern | Files | Count |
|---------|-------|-------|
| `bg-[hsl(var(--success))]` | `DisciplineChecklist`, `SitePlanChecklist`, `ScanTimeline`, `FindingStatusFilter`, `FindingCard` | ~12 |
| `bg-[hsl(var(--warning))]` | `DeadlineBar`, `FindingCard`, `LetterPanel`, `PlanReviewDetail`, `FindingStatusFilter` | ~8 |
| `bg-[hsl(149_60%_95%)]` | `DaysActiveBadge` | 1 |
| `bg-[hsl(43_100%_95%)]` | `DaysActiveBadge` | 1 |
| `bg-[hsl(1_65%_95%)]` | `DaysActiveBadge` | 1 |
| `border-[hsl(var(--success))]` | `SitePlanChecklist`, `DisciplineChecklist`, `FindingCard` | ~5 |
| `text-[hsl(var(--success))]` | `SitePlanChecklist` | 2 |

**Root cause**: `success` and `warning` are defined as CSS vars and in `tailwind.config.ts`, so `bg-success` and `bg-warning` should work. Components are using the long-form `bg-[hsl(var(--success))]` instead of the shorthand `bg-success`.

**`DaysActiveBadge` uses raw HSL strings** (`hsl(149_60%_95%)`) instead of referencing tokens — these are the "light background" variants of status colors with no token.

### Inline `style={{ color }}` (🟡 Medium)
- `Dashboard.tsx` line 36, 280 — `style={{ color: iconColor }}` where `iconColor` is a dynamic hex string passed from the KPI config. These are semantic colors (`#1a9988`, `#d69e2e` etc.) that duplicate design system values.

### Near-Duplicate Colors (🟢 Low)
All hardcoded hex values in `CommentLetterExport.tsx`, `CountyDocumentPackage.tsx`, and `DocumentsGen.tsx` are **print-only HTML templates** — these are intentional and should remain as-is for PDF rendering consistency. No in-app near-duplicates found.

### Color Token Coverage Assessment
The existing CSS variable system in `index.css` is **well-structured**. The main gap is:

| Missing Token | Used As | Currently |
|---------------|---------|-----------|
| `--success-bg` (light) | Badge/chip backgrounds | `hsl(149 60% 95%)` hardcoded |
| `--warning-bg` (light) | Badge/chip backgrounds | `hsl(43 100% 95%)` hardcoded |
| `--destructive-bg` (light) | Badge/chip backgrounds | `hsl(1 65% 95%)` hardcoded |
| `--status-admin-bg` (light) | Badge backgrounds | `hsl(209 60% 95%)` hardcoded in index.css `.badge-admin` |

### Semantic Color Map (current state — correct)
- **Primary actions**: `--primary` (teal 160 60% 38%) ✅
- **Secondary actions**: `--secondary` ✅
- **Backgrounds**: `--background`, `--card`, `--popover` ✅
- **Borders**: `--border` ✅
- **Text primary**: `--foreground` ✅
- **Text muted**: `--muted-foreground` ✅
- **Success/Warning/Error**: `--success`, `--warning`, `--destructive` ✅
- **Focus ring**: `--ring` ✅

---

## TYPOGRAPHY FINDINGS

### Arbitrary Font Sizes (🔴 High — 42 files affected)
The app uses **7 off-scale** `text-[Npx]` values extensively:

| Value | Tailwind Equivalent | Occurrences | Files |
|-------|-------------------|-------------|-------|
| `text-[8px]` | None (below `text-[10px]`) | ~15 | `SitePlanChecklist`, `FindingCard`, `DisciplineChecklist` |
| `text-[9px]` | None | ~20 | `SitePlanChecklist`, `DisciplineChecklist`, `StatusChip`-adjacent |
| `text-[10px]` | None (between xs and 2xs) | ~80+ | Nearly every component |
| `text-[11px]` | None (≈xs) | ~60+ | `KpiCard`, `StatusChip`, `StatutoryClockCard`, many others |
| `text-[13px]` | `text-sm` is 14px | ~5 | `Dashboard.tsx` |

**This is the #1 design consistency issue.** The app has developed a micro-typography system (`8px → 9px → 10px → 11px → 13px`) that lives entirely outside Tailwind's type scale.

### Proposed Type Scale Tokens
```
--text-2xs: 10px  (replaces text-[9px], text-[10px])
--text-xs:  11px  (replaces text-[11px]) — or keep Tailwind's 12px xs
--text-sm:  13px  (replaces text-[13px]) — close to Tailwind's 14px sm
--text-caption: 8px (for REQ tags, code refs — intentionally tiny)
```

### Heading Size Inconsistency (🟡 Medium)
- Dashboard KPI: `text-5xl` (48px) and `text-4xl` (36px) in same view
- KpiCard component: `text-3xl` (30px)
- Analytics page: `text-3xl`

---

## DESIGN TOKEN PROPOSAL

### 1. New CSS Variables for `:root` in `index.css`

```css
/* Light status backgrounds (missing tokens) */
--success-bg: 149 60% 95%;
--warning-bg: 43 100% 95%;
--destructive-bg: 1 65% 95%;
--admin-bg: 209 60% 95%;

/* Micro type scale */
--text-caption: 0.5rem;    /* 8px */
--text-2xs: 0.625rem;      /* 10px */
--text-xs: 0.6875rem;      /* 11px */
```

Dark mode overrides:
```css
.dark {
  --success-bg: 149 40% 15%;
  --warning-bg: 43 60% 15%;
  --destructive-bg: 1 45% 15%;
  --admin-bg: 209 40% 15%;
}
```

### 2. Tailwind Config Extension

```ts
colors: {
  success: {
    DEFAULT: "hsl(var(--success))",
    foreground: "hsl(var(--success-foreground))",
    bg: "hsl(var(--success-bg))",  // NEW
  },
  warning: {
    DEFAULT: "hsl(var(--warning))",
    foreground: "hsl(var(--warning-foreground))",
    bg: "hsl(var(--warning-bg))",  // NEW
  },
  // same for destructive-bg, admin-bg
},
fontSize: {
  caption: "var(--text-caption)",  // 8px
  "2xs": "var(--text-2xs)",        // 10px
  xs: "var(--text-xs)",            // 11px — override Tailwind default
}
```

### 3. Component Migration Map

Replace `bg-[hsl(var(--success))]` → `bg-success` (already works)
Replace `bg-[hsl(149_60%_95%)]` → `bg-success-bg` (new token)
Replace `text-[hsl(var(--success))]` → `text-success` (already works)
Replace `text-[10px]` → `text-2xs` (new token)
Replace `text-[11px]` → `text-xs` (remapped token)
Replace `text-[9px]` → `text-2xs` (consolidated)
Replace `text-[8px]` → `text-caption` (new token)
Replace `text-[13px]` → `text-sm` (use standard 14px)

---

## PRIORITY FIX LIST

| # | Priority | Issue | Scope | Files |
|---|----------|-------|-------|-------|
| 1 | 🔴 High | 42 files use arbitrary `text-[Npx]` — no type scale tokens exist | Typography | All major components |
| 2 | 🔴 High | `bg-[hsl(var(--success/warning))]` used instead of `bg-success`/`bg-warning` | Color | 6 components |
| 3 | 🔴 High | No light-bg tokens for status colors → `DaysActiveBadge` hardcodes raw HSL | Color | `DaysActiveBadge`, `index.css` badge classes |
| 4 | 🟡 Medium | Card padding inconsistency: `p-3` vs `p-5` vs `p-6` | Spacing | `Dashboard`, `KpiCard`, `Analytics`, `DisciplineChecklist` |
| 5 | 🟡 Medium | Dashboard KPI uses `style={{ color }}` with hex strings instead of tokens | Color | `Dashboard.tsx` |
| 6 | 🟡 Medium | `mt-[-18px]` off 4pt grid | Spacing | `HorizontalStepper.tsx` |
| 7 | 🟢 Low | Print template inline styles (intentional) | Color | `CommentLetterExport`, `CountyDocumentPackage`, `DocumentsGen` |
| 8 | 🟢 Low | `rounded-[2px]` in chart.tsx (shadcn default) | Spacing | `chart.tsx` |

---

## PHASE 3 — IMPLEMENTATION STEPS (awaiting approval)

**Step 1**: Add new CSS variables (`--success-bg`, `--warning-bg`, `--destructive-bg`, `--admin-bg`, `--text-caption`, `--text-2xs`, `--text-xs`) to `:root` and `.dark` in `index.css`

**Step 2**: Extend `tailwind.config.ts` with `success.bg`, `warning.bg`, `destructive.bg` color tokens and `caption`/`2xs` font-size tokens

**Step 3**: Fix components one-by-one:
- Replace `bg-[hsl(var(--success))]` → `bg-success` (6 files)
- Replace `bg-[hsl(149_60%_95%)]` → `bg-success-bg` (DaysActiveBadge + badge classes)
- Replace `text-[10px]`/`text-[11px]`/`text-[9px]`/`text-[8px]`/`text-[13px]` → new scale tokens (42 files)
- Standardize card padding to `p-5` or `p-6` (4 files)

**Step 4**: Final token coverage report

Total estimated violations: **~180+** across 42 files
Print-template exceptions (intentional): 3 files excluded

