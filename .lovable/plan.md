## The problem

After uploading a PDF, the left panel of `/plan-review/:id` either shows the empty drop zone or a tiny "Loading document…" spinner with a thin progress bar. Meanwhile the actual pipeline (upload → prepare_pages → sheet_map → … → comment letter) is humming along, but its only visual home is a popover hidden behind the "Re‑Analyze" button in the top bar. Users can't tell that anything is happening, so it feels broken.

The fix: turn the left canvas itself into the pipeline status during processing, then automatically transition into the PDF + comments view the moment the pipeline lands. No extra clicks, no hidden popover, no jargon.

## What we'll build

### 1. New `ProcessingOverlay` component (left canvas)

When a review has files but is still processing (no rendered page images yet, OR the pipeline terminal stage isn't `complete`), the left panel renders a centered, calm "we're working on it" surface instead of the blank drop zone or a 8px spinner.

```text
┌──────────────────────────────────────────────────┐
│                                                  │
│             ⟳  Reviewing your plans              │
│        Architectural — chunk 5 of 10             │
│                                                  │
│   ✓ Files received                               │
│   ✓ Prepared 24 pages                            │
│   ✓ Indexed sheets                               │
│   ⟳ Reading discipline sheets · 12s ago          │
│   ○ Cross‑checking findings                      │
│   ○ Grounding code citations                     │
│   ○ Drafting comment letter                      │
│                                                  │
│   Usually 2–4 minutes. You can leave this page   │
│   — we'll notify you when it's done.             │
│                                                  │
│            [View pipeline dashboard]             │
└──────────────────────────────────────────────────┘
```

Implementation:
- New file `src/components/plan-review/ProcessingOverlay.tsx`.
- Internally just renders the existing `<PipelineProgressStepper compact mode="core" />` with a wrapper that adds the headline, current sub-stage subtitle (pulled from `disciplineProgress` when discipline_review is running), and an "estimated time" line.
- Reuses all the heartbeat / stuck / auto-retry logic already in `PipelineProgressStepper` — no duplication.

### 2. Wire it into `PlanViewerPanel`

`PlanViewerPanel` currently has three states: empty drop zone, "Loading document…" spinner, and the rendered viewer. Add a fourth state and reorder priority:

1. No documents → drop zone (unchanged).
2. Documents present **and pipeline not complete** → `<ProcessingOverlay planReviewId=… />` (NEW).
3. Documents present + pipeline complete + still rasterizing locally → existing tiny "Loading document…" spinner.
4. `pageImages.length > 0` → `PlanMarkupViewer` (unchanged).

The page already knows `pageAssetCount`, `pipeRows` (via `usePipelineStatus`), and the terminal stage status — pass a single derived `processingState: "uploading" | "preparing" | "analyzing" | "ready"` prop down to keep `PlanViewerPanel` dumb.

### 3. Auto-flip to "ready" view on completion

When the terminal stage transitions to `complete`:
- The existing `PipelineProgressStepper.onComplete` already fires once. Hoist that handler to the page level so both the top‑bar popover and the new overlay share it.
- On complete: invalidate `plan-review`, `pipeline_status`, and `page-asset-count` queries (already done in the existing `onPipelineComplete`), and flash a single subtle toast: "Review ready · {N} findings". No modal, no extra step.
- Once `pageImages` are rendered, the overlay automatically unmounts and the PDF + pin overlays appear — which is already the existing behavior, so this part is just confirming the auto-transition works without a manual click.

### 4. Quiet the existing UI noise during processing

The current page stacks several banners above the canvas during processing (`StuckRecoveryBanner`, `SubmittalIncompleteBanner`, `DNAConfirmCard`, `ReviewProvenanceStrip`). They're useful *after* completion but compete for attention during the run. Rules:
- `DNAConfirmCard`, `ReviewProvenanceStrip`, `RoundCarryoverPanel`: keep gated on `findings.length > 0` (already is for some). Add the same gate to DNAConfirmCard.
- `StuckRecoveryBanner` and `SubmittalIncompleteBanner` and `preparePagesErrored`: keep — these are actionable error states and need to be visible.
- The thin `UploadProgressBar` at the top stays during the actual file upload only (already correct).

### 5. Pin placement on the PDF (already correct, just verify)

The user mentioned "all of the comments would be placed according to the page that they relate to." This is already how it works — `PlanMarkupViewer` renders `findings[i].markup.page_index/x/y/width/height` overlays per-page, deterministic placement is handled by the existing pin-placement logic in memory. **No change needed**, but the plan calls it out so we double‑check after the auto-flip lands that pins render correctly on first paint (no flash of unmarked PDF).

## Files

**New**
- `src/components/plan-review/ProcessingOverlay.tsx` — full-canvas processing surface; thin wrapper around `PipelineProgressStepper`.

**Modified**
- `src/components/plan-review/PlanViewerPanel.tsx` — accept `processingState`, render `ProcessingOverlay` when documents exist but processing isn't done.
- `src/pages/PlanReviewDetail.tsx` — derive `processingState` from `pipeRows` + `pageAssetCount` + `pageImages`, pass it down; add gentle "Review ready" completion toast; gate `DNAConfirmCard` on `findings.length > 0`.

## Out of scope (call-outs)

- We are NOT removing the top‑bar popover stepper — it's still useful as a persistent peek and works once the overlay disappears.
- We are NOT adding background/desktop notifications here — Phase C already shipped `usePipelineCompleteNotifications` for that.
- No schema changes, no new edge functions, no new dependencies.

## Risks

- The page already mounts a lot of realtime subscriptions; the overlay reuses `usePipelineStatus` (same channel) so no extra socket cost.
- One race to verify: after `onComplete` fires, `pageImages` may take 1–3s to finish rasterizing in-browser — during that window the overlay should show the existing tiny "Loading document…" state (step 3 above), not bounce back to the full processing surface.

Approve to ship this as a single self-contained patch.
