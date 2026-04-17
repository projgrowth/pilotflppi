---
name: Pin Placement (grid-anchored)
description: How AI findings are anchored to PDF coordinates via a 10×10 visible grid + nearest-text + confidence tiers
type: feature
---

# Pin placement pipeline

The AI never picks coordinates by eye. Every plan page sent to the model has a faint red **10×10 grid** drawn on top with cells labelled `A0`..`J9` (rows A-J top→bottom, columns 0-9 left→right). The model returns `grid_cell` + `nearest_text` per finding; the viewer trusts the cell over raw `x/y`.

## Pipeline

1. `renderPDFPagesForVisionWithGrid()` (`src/lib/pdf-utils.ts`) renders each page at 220 DPI then overlays the labelled grid before base64 encoding.
2. The `plan_review_check_visual` prompt instructs the model to: (a) read the title block sheet designation, (b) name the `grid_cell` containing the element, (c) capture a `nearest_text` string visible within ~5% of the pin, (d) refine `x/y/width/height` inside that cell.
3. Tool schema (in `supabase/functions/ai/index.ts`) requires `grid_cell` and `nearest_text` on every `markup`.
4. Post-parse in `PlanReviewDetail.runAICheck`:
   - `gridCellToCenter(cell)` → cell center (col*10+5, row*10+5).
   - The pin's geometric center is **clamped to ±5%** of cell center, bounding worst-case error to one cell (~10%).
   - `pin_confidence` is computed: `high` (grid_cell + nearest_text), `medium` (grid_cell only), `low` (neither).
5. `handleRepositionConfirm` always sets `pin_confidence: "high"` and `user_repositioned: true` — manually placed pins are never downgraded on reload.

## Viewer rendering tiers (`PlanMarkupViewer.tsx`)

- **high** → solid red crosshair (current look).
- **medium** → dashed red crosshair + "~" overlay in the badge.
- **low** → dashed amber crosshair + "approx" badge + ~20% search ring around the pin.
- Sheet badge gets a confidence dot prefix: `●` high, `◐` medium, `○` low.

## FindingCard hint

When `pin_confidence !== "high"`, the card shows an "Approximate location" panel with `nearest_text` (or the grid cell) plus a promoted **Place pin** action that opens the reposition flow. The "Wrong location?" button only appears for `high` confidence pins.

## Storage

`pin_confidence`, `grid_cell`, `nearest_text`, `user_repositioned` all ride inside the existing `markup` JSON on `ai_findings.plan_reviews`. No DB migration.
