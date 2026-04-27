
## What's actually wrong with Suncoast Porsche (and why)

I queried the latest run (`aa5638ef…`, 78 pages, 26 findings, status `complete`) and traced it through `pipeline_error_log`, `review_pipeline_status`, `sheet_coverage`, `project_dna`, and `deficiencies_v2`. Three independent failures stacked:

### 1. Submittal is incomplete and nothing flagged it
Sheet map is correct: every page is `A-`, `AD-`, or `G-` prefixed. There is **no Structural, MEP, Plumbing, Electrical, or Fire Protection** in the upload — for a 51,086 sf, 2-story, mixed A-3/S-2 auto dealership. The pipeline doesn't notice. It runs `discipline_review` on Architectural only, then ships 26 findings, most of which are unanswerable (e.g. "construction type missing from cover sheet" — true, but Structural/MEP wouldn't be in the set anyway). The reviewer can't tell from the dashboard that this is a partial submittal vs. a complete one with bad arch.

### 2. `ground_citations` silently skipped
`review_pipeline_status` for this run lists 7 stages: `upload, prepare_pages, sheet_map, dna_extract, discipline_review, dedupe, complete`. **No `ground_citations` row exists.** Across the last 7 days, 11 of 16 reviews never created a `ground_citations` row. All 26 findings on Suncoast still have `citation_status='unverified'` and `citation_grounded_at IS NULL`. Cause: the orchestrator advances `activeChain[idx+1]` after dedupe, but `scheduleNextStage` for `ground_citations` is being lost (likely a worker crash with no `pipeline_error_log` entry, or the entry-point used a stale `activeChain` from before `ground_citations` was promoted to CORE). Either way, **the Plan B "core stage" promotion isn't actually executing.**

### 3. Findings duplicate the DNA gap instead of being suppressed by it
DNA extracted `construction_type=NULL`, `wind_speed_vult=NULL`, `flood_zone=NULL`, etc. (10 missing fields). Architectural expert then wrote **6 separate findings** (DEF-A001…A008) all saying variants of "construction type / FBC edition / code summary missing from cover sheet." The DNA stage already knows this; the discipline experts shouldn't be re-flagging the same gap 6 times.

### 4. DNA didn't read sheets G003/G004 (which are literally "Code Information")
Sheets `G003 — Code Information - Occupancy` and `G004 — Code Information - Energy` exist in the set. DNA extracted `occupancy_classification = "A-3; S-2"` (good) but missed everything else. So either the DNA stage didn't include G003/G004 in its vision payload, or it did but parsed only occupancy. This is the upstream cause of #3.

---

## Plan: fix these four things in one pass

### A. Add a Submittal Completeness Gate (new pipeline stage, runs after `sheet_map`)
- New stage `submittal_check` inserted into `CORE_STAGES` between `sheet_map` and `dna_extract`.
- Logic: given the DNA's `occupancy_classification`, `total_sq_ft`, `stories`, decide which trade disciplines are reasonably required for permit. For commercial > 5,000 sf: require S, M, P, E. For ≥2 stories or A/B/F/M occupancy: require FP. If a required discipline has **zero sheets** in `sheet_coverage`, write **one** `requires_human_review=true` finding to `deficiencies_v2` titled "Submittal incomplete — [Trade] drawings not provided" and set `plan_reviews.ai_run_progress.submittal_incomplete = true`.
- New top-of-page banner on `PlanReviewDetail` shown when `submittal_incomplete=true`: "Architectural-only submittal — 5 trades not provided. Confirm whether resubmittal is required before issuing comments."
- The discipline_review stage for the present trades still runs — but every finding from those reviews is annotated `submittal_context: "architectural_only"` so the letter export adds a preamble: "These comments cover the architectural set only. Structural, MEP, Plumbing, Electrical, and Fire Protection drawings must be submitted under separate cover."

### B. Fix `ground_citations` actually executing
- Root cause hypothesis: when the chain advances from `dedupe`, `setStage(...,{status:'pending'})` for `ground_citations` is happening but the `scheduleNextStage` self-invoke is being dropped. Two reinforcing fixes:
  1. **Watchdog sweep at the start of every `complete` stage**: before marking complete, call `runPendingTailStages()` which scans `review_pipeline_status` for any stage in `activeChain` that is not in (`complete`,`error`) and runs them inline before completing. Belt-and-suspenders.
  2. **Make `ground_citations` idempotent + invokable on already-complete reviews**: add a "Re-ground citations" button on `PlanReviewDetail` (admin only) that POSTs `start_from=ground_citations` to the edge function. Cost: one DB query per finding, no AI.
- One-time backfill: for every existing review with `citation_grounded_at IS NULL`, run `stageGroundCitations`. Use a small Node script via the edge function, not a migration.

### C. DNA-Aware Discipline Review
- Pass DNA's `missing_fields` array into every discipline expert's system prompt as: *"The cover-sheet code summary is already known to be missing the following items: [list]. **Do not** re-raise findings about these specific gaps — they're tracked separately. Focus on technical compliance issues you can identify from the drawings themselves."*
- Add a post-discipline filter: any finding whose normalized text matches a DNA-gap pattern (`/cover sheet.*missing/i`, `/construction type.*not specified/i`, `/code summary.*required/i`) is auto-merged into a single "DNA gap" finding instead of being kept separately. Reuses the existing dedupe bucketing.

### D. Force DNA to actually read code-summary sheets
- `stageDnaExtract` currently picks "cover/code-summary pages from sheet_coverage; fall back to first 3 pages." Looking at the code (line 1006-1009), the matcher is loose. Change it to **always include any sheet whose title contains "code", "occupancy", "summary", "data" (case-insensitive)** plus the first 2 sheets, and pass them all in one Gemini Pro call (not Flash). Cost is small (≤5 pages); accuracy gain is huge.
- Add a logged metric `dna_pages_read` so we can audit which sheets DNA actually saw.

---

## Diagnostics added to the dashboard (free, no schema change)

- **Per-review provenance row** at top of `PlanReviewDetail`:
  `Sheet map: 78 (A:74, G:4, S:0, M:0, P:0, E:0, FP:0)` · `DNA: 6/16 fields` · `Citations: 0/26 grounded` · `Disciplines run: 1/9`. Color-coded green/amber/red. Anyone looking at the page sees the gaps in 1 second.
- **Pipeline tail check** on the existing `useReviewHealth` hook: surface `ground_citations_skipped: true` when the stage row is missing or `citation_grounded_at IS NULL` for any finding. Show as red badge in the dashboard "Active reviews" list.

---

## Out of scope for this pass (parking lot)

- Switching sheet_map to a single-call Pro vision pass instead of 4-image Flash batches (would help differently-shaped projects but Suncoast wasn't a sheet_map failure).
- Per-county "required disciplines" override matrix.
- Auto-rejecting incomplete submittals at upload time (we should warn, not block — sometimes private-provider clients want partial review for early feedback).

## Technical details

**Files to change**

- `supabase/functions/run-review-pipeline/index.ts`
  - Insert `submittal_check` stage (`Stage` union, `STAGES`, `CORE_STAGES`, `stageImpls`).
  - Add `stageSubmittalCheck()` (~80 lines).
  - In `stageComplete()`, prepend `runPendingTailStages()` watchdog (~40 lines).
  - In `stageDnaExtract()`, broaden cover/code-summary sheet selection (~15 line diff).
  - In each discipline expert prompt builder, append DNA gap notice (~5 lines × 9 disciplines).
  - In `stageDedupe()`, add DNA-gap auto-merge bucket (~25 lines).
- `src/pages/PlanReviewDetail.tsx` — completeness banner + provenance strip (~60 lines added).
- `src/hooks/useReviewHealth.ts` — `ground_citations_skipped` derivation (~10 lines).
- `src/components/plan-review/StuckRecoveryBanner.tsx` — add "Re-ground citations" admin action (~20 lines).
- One-shot backfill: invoke `start_from=ground_citations` for the 11 stuck reviews after deploy.

**No DB schema changes required.** Existing columns (`citation_status`, `requires_human_review`, `ai_run_progress` JSONB) cover everything.

**Estimated cost per run after changes**: +1 DB roundtrip for completeness check, +0 AI calls (the gap check is purely structural). DNA accuracy improves at the cost of ~1 extra page in the existing DNA call. Net pipeline cost: roughly flat.

