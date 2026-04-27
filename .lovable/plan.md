# Plan review: scope confirmation + UX cleanup

## Will the recent changes apply to all plan reviews?

Yes. Everything we just shipped is global:

- **Pipeline orchestrator** (`run-review-pipeline` edge function) — every new run uses the new `CORE_STAGES` order including `submittal_check` and `ground_citations`.
- **Health metrics** (`useReviewHealth`) — reads live from `deficiencies_v2` per review, so any review (old or new) gets the grounded / low-confidence / needs-review numbers on next page load.
- **Export safety gate** (`CommentLetterExport`) — fires for any letter export where unverified citations exist.
- **DNA schema fix** — unblocks `dna_extract` for every run.

Nothing is keyed to a project ID. Older reviews benefit from the UI-side fixes immediately; the pipeline-side fixes apply to the next time a review runs (re-run, resubmittal, or new upload).

The one thing that is **not** yet visible to users: the new `submittal_check` stage runs but its label and the resulting `submittal_incomplete` flag are not surfaced anywhere in the UI. That is the top item below.

---

## What we'll fix in this loop

### 1. Make the new gates visible

a. **Stepper labels** — add `submittal_check` to `FRIENDLY_LABELS` and `FRIENDLY_HINTS` in `PipelineProgressStepper.tsx` so it renders as "Submittal check / Verifying required trades are present" instead of a blank pill.

b. **Submittal-incomplete banner** on `PlanReviewDetail` — when `ai_run_progress.submittal_incomplete === true`, show a yellow strip above the findings panel:

```text
Submittal incomplete — missing: Structural, MEP, Fire Protection
This review will continue, but a permit-blocker DEF-SUB001 has been opened.
[View finding]  [Mark as deferred submittal]
```

c. **Provenance strip** at the top of the findings panel (one line, always visible):

```text
74 findings · 71 grounded · 3 need review · DNA 12/14 fields · Submittal: incomplete
```

Pulls from the existing `useReviewHealth` hook + `project_dna.missing_fields` + `ai_run_progress.submittal_incomplete`. No new queries needed.

### 2. Smoother upload → review hand-off

Today the user drops a file and stares at a stepper. Three small fixes:

a. **Upload zone copy** — replace "Drop plan documents here" with a 2-line hint:
   - "Drop the full plan set (PDF). Include cover, code summary, and all discipline sheets."
   - Sub-line: "We'll auto-detect Architectural, Structural, MEP, Civil, and Fire Protection."

b. **Auto-jump to findings when ready** — when `ai_check_status` flips to `complete` and the right panel is on `letter` or empty, switch it to `findings` and toast "Review complete — N findings".

c. **Single status header** — the page currently has the stepper, the `StuckRecoveryBanner`, the `UploadProgressBar`, and the top bar all stacked. Group them into one collapsing "Pipeline status" card that auto-collapses to a one-line summary once the run is complete, so reviewers reading the letter aren't looking at a giant in-progress UI.

### 3. Findings panel: easier to triage

a. **Default sort = confidence ascending, then severity** so reviewers see the AI's least-confident calls first (the ones that actually need eyes) instead of scrolling.

b. **"Needs human review" pill** at the top of the filter row — one click filters to `requires_human_review = true`. Currently buried in the filter dropdown.

c. **Citation status icon on every card** — small inline glyph: green check (grounded), grey dash (unverified), red triangle (mismatch). Pulls from `citation_status` / `citation_match_score` already on the row.

### 4. Letter export: clearer pre-flight

The export gate dialog currently says "unverified citations exist — confirm". Add a count and a "Jump to findings" button so the reviewer can fix them in one click instead of guessing which findings are flagged.

---

## Files to change

- `src/components/plan-review/PipelineProgressStepper.tsx` — add `submittal_check` labels.
- `src/pages/PlanReviewDetail.tsx` — submittal banner, provenance strip, auto-switch to findings on complete, collapse status into one card.
- `src/components/plan-review/PlanViewerPanel.tsx` — upload zone copy.
- `src/components/plan-review/FindingsListPanel.tsx` — default sort, "needs review" quick filter, citation icon on cards.
- `src/components/FindingCard.tsx` — citation status icon.
- `src/components/CommentLetterExport.tsx` — show count + jump-to-findings in the gate dialog.

No DB migrations. No edge function changes. All data already exists on the rows we're reading.

---

## What we're explicitly **not** doing in this loop

- Re-running historical reviews to backfill the new `submittal_check` finding. (Reviewers can re-run individual projects from the existing "Run AI check" button if they want it.)
- Touching the deep-pipeline stages (`verify`, `cross_check`, `deferred_scope`, `prioritize`).
- Sidebar / dashboard changes — those were already trimmed in the previous loop.

Approve and I'll ship it.