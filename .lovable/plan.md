
# Upload-to-Letter UI Audit & Improvements

Scope: every screen the user sees from the moment they click "New Review" through landing on a finished comment letter. Findings are grouped by surface, ordered roughly by user-visible impact.

---

## 1) `NewReviewDialog` (the upload + intake form)

What's working: drop zone + AI auto-fill is good. What hurts:

- **Submit button reads "Create & Open" but actually backgrounds the upload after navigating.** Users don't realize the upload is still running off-screen if they close the laptop. Reword to "Start review" and add an inline microcopy line under the button: *"We'll keep uploading in the workspace — don't close your browser for ~30 sec."*
- **No upload progress in the dialog itself.** Once the user clicks submit, the dialog closes immediately while the upload may take 10-60s. Replace the `close()` + `navigate()` with a 1-stage in-dialog progress state ("Uploading 2 of 3 files…") and only navigate after the first byte of the pipeline acknowledges. Keeps the perception of "I clicked, something is happening here."
- **Use-type cards take vertical space twice the size of every other field.** Compact them to a horizontal segmented control matching the trade/services selects — this dialog scrolls on a 13" laptop today.
- **`extracting` ("AI auto-filling…") indicator is hidden inside a tiny 11px line under the file list.** Promote to a chip next to the project-name input so users see *which field is being filled*.
- **HVHZ banner is destructive-red but shown for a normal, expected condition.** Switch to `warning` tone (amber). Destructive should be reserved for blockers.
- **Existing-project match card has no "create new instead" affordance.** If the AI matches the wrong project, the only escape is to clear the name. Add a subtle "Not this project — create new" link inside the card.
- **Duplicate file inputs.** `NewReviewDialog`, `PlanViewerPanel`, and `PlanReviewDetail` each create their own hidden `<input type="file">`. Consolidate into one ref to avoid the iOS Safari double-tap bug.

---

## 2) Bootstrapping → processing transition (`PlanReviewDetail` + `ProcessingOverlay`)

This is the screen the user sees for the longest time. Several things compete here:

- **Two overlays can render at once.** `ProcessingOverlay` lives inside `PlanViewerPanel`, but `ReviewTopBar` ALSO opens a popover with another `PipelineProgressStepper` while `aiRunning`. Result: same stepper rendered twice. Pick one — kill the top-bar popover when `pipelineProcessing` is true (the canvas overlay is already loud). Keep the popover only as a "peek progress while you keep working" affordance after the user dismisses the overlay.
- **`UploadProgressBar` AND `ProcessingOverlay` both show during upload.** Hide the inline strip when the overlay is on screen — they restate the same counters.
- **The overlay's "Don't close this tab" warning never lifts.** Once we reach the `analyzing` phase, closing the tab is fine (pipeline runs server-side). Show that warning ONLY in `uploading`/`preparing`. Add a positive "Safe to close — we'll email you when it's done" line in `analyzing`.
- **No wall-clock estimate.** Pipeline takes 2-4 min but the overlay only says so in tiny gray text. Add a simple elapsed/ETA pair at the top right of the overlay card (`1:42 elapsed · ~2 min left`). Resets ambiguity about whether anything is happening.
- **Right panel (findings) shows a separate "Analyzing…" placeholder** at the same time. Three "we're working on it" surfaces on one screen is one too many. Collapse the right panel automatically while `pipelineProcessing` so the canvas overlay owns the moment, then auto-expand on completion with a flash.
- **`bootstrapping` phase has no useful visual.** It's a spinner + "Saving your project". Add the project name + uploaded file chips so the user sees the data they just typed reflected back — instant trust signal.

---

## 3) Banner hierarchy (above the fold)

Today, when things go sideways, up to 4 banners can stack:
`StuckRecoveryBanner` (4 variants) + `SubmittalIncompleteBanner` + `ReviewProvenanceStrip` + `LetterReadinessGate`.

- **Cap to one prominent banner at a time.** Promote whichever is highest priority (blocker > warning > info), collapse the rest into a small "+2 more" pill that expands.
- **Warning vs destructive colors are inconsistent.** `needs_user_action` uses warning yellow, `needs_human_review` uses destructive red, `needs_preparation` uses warning yellow but is the most blocking of the three. Re-rank by user impact: blockers (red) = `needs_preparation`, `needs_user_action`; warnings (amber) = `needs_human_review`, `submittal_incomplete`; info (green) = auto-recovery success.
- **All banners use `text-2xs` (10px).** Eye-strain. Bump to `text-xs` (12px) for body, keep `text-2xs` only for metadata.

---

## 4) `PipelineProgressStepper`

- **"Stuck for >90s — auto-restarting…" appears even when the AI is doing legitimate work** (Gemini chunks routinely take 2-3 min on big sets). The discipline-review row already has a richer "chunk 5 of 10" line. Suppress the stuck message when `disciplineProgress.last_chunk_at` is fresh (<60s) — the heartbeat work added in Phase 3 is the source of truth, not `started_at`.
- **All 13 stage labels render even in `compact` mode.** Group them visually: *Setup* (upload, prepare_pages, sheet_map), *Analysis* (dna_extract, submittal_check, discipline_review), *QA* (verify, ground_citations, dedupe, cross_check), *Output* (prioritize, complete). One subheading per group. Reduces the "wall of bullet points" feeling.
- **No way to know *which* discipline is currently running** from the top-bar popover (only the canvas-overlay stepper has the live discipline line). Pass `disciplineProgress` through both renders.

---

## 5) `PlanViewerPanel` empty + post-render state

- **Empty drop zone says "Drop the full plan set (PDF)"** but the dialog the user just dismissed accepted multiple PDFs. Mismatch in language. Standardize on "Drop your plans (PDFs)".
- **File chips truncate at 240px with no tooltip.** When a user uploads `A-100_Architectural_Floor_Plans_Rev3.pdf`, they see `A-100_Architectural_Flo…`. Add `title={name}`.
- **"+ Add file" link is the same color as accent text** and easy to miss. Style as a small ghost button with a `+` icon to match the New Round CTA elsewhere.
- **No indication of which file a finding came from** when multiple PDFs are uploaded. The file tabs are passive labels — make them filter chips (click `A-100.pdf` → findings list filters to that file's findings). The data already exists via sheet_id → file_url.

---

## 6) Findings list during/after analysis

- **`FindingsListPanel` returns a centered "Analyzing…" card while pipeline runs.** Then on completion, the list materializes with no transition. Add a 200ms slide-in + a one-line summary toast: "Found 14 findings across 6 disciplines" — same energy as the green flash on the AI button.
- **`activeFindingIndex` highlight uses a subtle border change** that's invisible on smaller laptops. Add a 2px left border in accent color and a soft `bg-accent/5` to selected rows.
- **Severity donut + status filter + bulk triage chips + round diff banner = ~180px of header before users see a single finding.** On a 13" screen that means ≤ 3 findings visible. Collapse the donut and round diff into a single sticky line: `R3 · 14 findings · 3 critical · 2 new`. Move filters into a popover.

---

## 7) Mobile (`isMobile` branch)

- The mobile tabs `plans` / `findings` lose all the upload progress UI when the user is on the `findings` tab during processing. Surface a mini progress chip in the mobile tab bar (`Findings (analyzing 3/13)`).
- The processing overlay's `max-w-md` card is fine but the surrounding `p-6` makes it touch the edges on a 375px screen. Use `p-3` on mobile.

---

## 8) Letter handoff (post-pipeline)

- When pipeline completes, the user's view stays on findings — they have to click "Letter" tab to see the generated draft. Auto-switch the right panel to `letter` on completion (only the first time per round) and toast "Comment letter draft ready — review before sending".
- `LetterReadinessGate` + `LetterPanel` + `LetterLintDialog` all guard sending. Today they're three separate UI surfaces. Inline the readiness checklist as a sticky strip above the letter editor so users see what's still blocking *while* they edit.

---

## Implementation order (suggested phases)

1. **Phase A — high-impact polish (no logic changes):** banner hierarchy fix, `NewReviewDialog` button copy + use-type compaction, file-tab tooltips, severity-bar collapse, ETA on overlay. ~1 hour, no risk.
2. **Phase B — overlay deduplication:** kill duplicate stepper renders, hide `UploadProgressBar` when overlay shown, suppress false-stuck message during heartbeat. Touches `ReviewTopBar`, `PlanViewerPanel`, `PipelineProgressStepper`. ~2 hours, low risk.
3. **Phase C — completion handoff:** auto-switch to letter panel + readiness inline, transitional toast, slide-in for findings list. Touches `PlanReviewDetail`, `LetterPanel`, `FindingsListPanel`. ~2 hours, medium risk.
4. **Phase D — file/finding cross-linking:** make file tabs into filters, mobile progress chip, post-upload navigation cleanup in `NewReviewDialog`. ~3 hours, higher risk (touches data flow).

I recommend approving Phases A + B together as a single visible-improvement pass, then deciding on C and D after seeing results.

---

## Files involved

`src/components/NewReviewDialog.tsx`, `src/pages/PlanReviewDetail.tsx`, `src/components/plan-review/{ProcessingOverlay, UploadProgressBar, PlanViewerPanel, PipelineProgressStepper, ReviewTopBar, StuckRecoveryBanner, SubmittalIncompleteBanner, FindingsListPanel, LetterPanel, LetterReadinessGate}.tsx`.
