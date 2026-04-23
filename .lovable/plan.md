

## Smooth out the plan-review flow: upload → analyze → review, all in one place

### What you experience today (the friction)

1. You drag a PDF into "New Plan Review" → confirm details → click **Create Review**.
2. The wizard quietly fires the pipeline in the background (no progress shown) and dumps you on the **workspace** page.
3. Findings haven't arrived yet, so the workspace looks empty. To see if anything is happening you have to click **Back to dashboard** and then **Run Pipeline** again — which often double-fires the analysis.
4. Nothing ever asked whether the project is residential vs commercial, so the discipline experts run with generic assumptions.

### What the new flow looks like

```text
 Step 1: Upload   →   Step 2: Confirm   →   Step 3: Analyzing…   →   Workspace
  drop PDFs            • name/address         live stage stepper         findings
  AI extracts          • county/jurisdiction  (sheet_map → DNA →         already
  title block          • trade                 discipline → verify…)     loaded
                       • USE TYPE (new)        auto-routes when done
                       • services
```

The wizard becomes the single home for the entire intake-to-analyzed handoff. You never have to visit the dashboard manually to "kick it off."

### Specific changes

**1. Add a "Use Type" choice to the Confirm step (Step 2)** *(`NewPlanReviewWizard.tsx`)*
Two big tappable cards at the top of the form:
- **Commercial** — multi-occupancy, FBC Building, accessibility, life safety
- **Residential** — 1 & 2 family, FBC Residential (FBCR)

Selection is required to advance. Stored on the project as `use_type`. The Florida Building Code splits sharply between FBC and FBCR, so this single field meaningfully changes which discipline experts the pipeline activates and which code references they cite. We pass it through to the pipeline so the discipline-expert prompts can scope rules correctly (e.g. residential skips ADA, commercial doesn't apply FBCR Ch. 3).

**2. Insert a new Step 3: "Analyzing"** *(`NewPlanReviewWizard.tsx`)*
After **Create Review**, instead of closing and dumping the user on the workspace, the dialog flips to a third panel:

```text
  Analyzing your plans
  ─────────────────────
  ✓ Upload                  Files received
  ✓ Sheet map               12 sheets indexed
  ⟳ Project DNA             Reading title block & code data…
  · Discipline review       (waiting)
  · Verify                  (waiting)
  · Dedupe / cross-check    (waiting)
  · Comment letter draft    (waiting)

           [ Continue in background ]   [ Open workspace ]
```

The stepper subscribes via Supabase Realtime to `review_pipeline_status` filtered by `plan_review_id`, so each tick lands live (no polling). When the `complete` stage arrives, the dialog auto-closes and routes to `/plan-review/:id` with findings already populated. If a stage errors, we surface the error inline with a **Retry** button (re-invokes `run-review-pipeline` from the same dialog) instead of silently succeeding.

**Continue in background** lets the user dismiss the dialog and keep working — the pipeline keeps running, and a small toast "Analyzing Pizza & Pasta…" shows when it finishes (clickable, opens the workspace).

**3. Hand off the use_type to the pipeline** *(migration + `run-review-pipeline/index.ts`)*
- Migration: add `projects.use_type text` (nullable, no default) so existing rows aren't disturbed.
- Pipeline reads `project.use_type` once at the top, includes it in the system prompt for `dna_extract` and `discipline_review`, and uses it to skip irrelevant disciplines (e.g. ADA when residential single-family).
- DNA extraction prompt is told the use_type up front, so it stops guessing and the DnaHealthBanner stops yelling about ambiguous occupancy on every residential project.

**4. Remove the duplicate "Run Pipeline" button on the dashboard** *(`ReviewDashboard.tsx`)*
Replace the prominent **Run Pipeline** button with a smaller **Re-run Analysis** action tucked in the toolbar (kept for the case where a reviewer uploads new sheets in a later round). The dashboard stops being a place you "have to remember to visit" — it becomes purely the QA/oversight surface it was meant to be.

**5. Honest pipeline result surfacing in the workspace topbar** *(`PlanReviewDetail.tsx` / `ReviewTopBar.tsx`)*
Since the pipeline now runs from the wizard, the workspace's existing **Run AI Check** button becomes **Re-Analyze** and gets the same realtime stage stepper inline (using the same component as Step 3) instead of a generic spinner. Reviewers can see exactly where it is.

### Files touched

- Edit: `src/components/NewPlanReviewWizard.tsx` — add use_type cards, add Step 3 analyzing panel with realtime stepper, route on completion
- New: `src/components/plan-review/PipelineProgressStepper.tsx` — realtime stage list driven by `review_pipeline_status` (reused in wizard Step 3 and workspace topbar)
- Edit: `src/pages/PlanReviewDetail.tsx` and `src/components/plan-review/ReviewTopBar.tsx` — swap spinner for the new stepper during re-analysis
- Edit: `src/pages/ReviewDashboard.tsx` — demote "Run Pipeline" to "Re-run Analysis"
- Edit: `supabase/functions/run-review-pipeline/index.ts` — read `project.use_type`, inject into DNA + discipline-expert prompts, skip disciplines that don't apply
- New migration: add `projects.use_type` column

### After the change

Drop a PDF → confirm → pick commercial/residential → watch it analyze (or dismiss and get pinged) → land on the workspace with the comment letter and findings already there. No second screen, no second button, no guessing.

