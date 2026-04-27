# Suncoast Porsche audit — root causes and fix plan

I traced the latest 3 Suncoast Porsche reviews. The backend is healthy: 78/78 pages rasterized, 12–44 deficiencies written per run, sheet maps snapshotted, no pipeline errors. The bug is entirely in the **client adapter + viewer wiring**.

## What's actually broken

### 1. Findings vanish from the list (the "doesn't show what the actual findings are")

- DB `deficiencies_v2.discipline` stores values like **`Architectural`, `General`, `Energy`** (71 of 75 findings on this project are `Architectural`).
- `src/lib/deficiency-adapter.ts` lowercases + slugifies → `"architectural"`, `"general"`.
- `src/lib/county-utils.ts` `DISCIPLINE_ORDER` only contains: `structural, life_safety, fire, mechanical, electrical, plumbing, energy, ada, site` — **no `architectural` and no `general`**.
- `FindingsListPanel` renders only `DISCIPLINE_ORDER.filter(d => filteredGrouped[d])`, so 71 of 75 Architectural findings are silently filtered out of the accordion. The summary header still counts the raw array (that's why the user sees "14 findings" but a near-empty list).

### 2. PDF viewer shows no pins (the "buggy PDF viewer")

- `PlanMarkupViewer` keys every annotation off `finding.markup.page_index`.
- The v2 adapter never sets `markup`. There is no `markup` column on `deficiencies_v2`.
- `checklist_state.last_sheet_map` (78 entries per review) maps `sheet_ref → page_index`, but nothing on the client joins findings to it.
- Result: pages render fine (eager + idle background), but every finding falls through `if (!finding.markup) return null;` so zero pins are drawn. From the user's perspective this looks like the viewer is broken.

### 3. Noisy console warning

- `Badge` is a plain function component. Radix Accordion forwards a ref into it (line 193 of `FindingsListPanel`), producing the `Function components cannot be given refs` warning seen in the console. Cosmetic, but worth a 1‑line fix while we're in there.

## Fix plan

### A. Expand the discipline taxonomy
`src/lib/county-utils.ts`
- Add `architectural`, `general`, `mep` (a common pipeline output), and `civil` to the `Discipline` union, `disciplineConfig`, and `DISCIPLINE_ORDER`.
- Order: `general → architectural → structural → life_safety → fire → mechanical → electrical → plumbing → mep → energy → ada → site → civil`.

### B. Make the list resilient to unknown disciplines
`src/components/plan-review/FindingsListPanel.tsx`
- Replace `DISCIPLINE_ORDER.filter((d) => props.filteredGrouped[d])` with: keys from `DISCIPLINE_ORDER` first (in canonical order), then **append any extra keys present in `filteredGrouped`** at the end. Guarantees no group is ever silently dropped, even if the AI emits a new label.

### C. Compute deterministic pin coordinates from the sheet map
`src/lib/deficiency-adapter.ts`
- New signature: `adaptV2ToFindings(rows, sheetMap)` where `sheetMap = Array<{ sheet_ref, page_index }>` from `plan_reviews.checklist_state.last_sheet_map`.
- For each finding, look up the first `sheet_refs[0]` in the map → `page_index`. Then derive deterministic `x/y/width/height` from a hash of `finding.id + sheet_ref` (per the existing `mem://logic/pin-placement` rule). Stamp `markup = { page_index, x, y, width: 0.06, height: 0.04, pin_confidence: 'low' }` so the viewer renders a pin even before grounding upgrades it.
- If `sheetMap` is missing or the sheet isn't found, leave `markup` undefined (existing fallthrough). Do not crash.

### D. Pass the sheet map through
`src/hooks/plan-review/usePlanReviewData.ts` / `src/pages/PlanReviewDetail.tsx`
- Read `plan_review.checklist_state.last_sheet_map`, pass to `adaptV2ToFindings`. No DB changes — the column already exists.

### E. Quiet the ref warning
`src/components/ui/badge.tsx`
- Convert `Badge` to `React.forwardRef<HTMLDivElement, BadgeProps>`. Two-line change.

## Out of scope (already-known, separate issues)
- The earlier `b443092b…` zero-asset failure is the previously-tracked "needs browser rasterization" CTA work — not touched here.
- The two soft-timeout `discipline_review` resumes seen in edge logs are the chunked-pause mechanism working as designed.

## Files touched
- `src/lib/county-utils.ts`
- `src/components/plan-review/FindingsListPanel.tsx`
- `src/lib/deficiency-adapter.ts`
- `src/hooks/plan-review/usePlanReviewData.ts`
- `src/pages/PlanReviewDetail.tsx`
- `src/components/ui/badge.tsx`

After these changes, opening a Suncoast Porsche review should show all 71 Architectural findings grouped under an Architectural accordion, with a deterministic pin on the correct page for every finding that has a `sheet_refs[0]` resolvable in the sheet map.
