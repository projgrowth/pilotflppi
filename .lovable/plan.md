## Goal

Stop trying to be clever on residential. The user's concern is simple: **nail the checklist and prep the cover sheet**. Right now even after Residential Mode, a residential run still fans out to 5 disciplines, runs critic + dedupe + ground_citations + verify + challenger, and lets the model freelance findings. We're going to collapse it.

## What stays vs. what goes (residential only)

```text
CURRENT residential CORE chain (10 stages):
  upload → prepare_pages → sheet_map → callout_graph → submittal_check
  → dna_extract → discipline_review (×5 experts) → critic → dedupe
  → ground_citations → verify → challenger → complete

NEW residential chain (6 stages):
  upload → prepare_pages → sheet_map → cover_scope → checklist_sweep
  → ground_citations → complete
```

Removed for residential: `callout_graph`, `submittal_check` (already skipped), `dna_extract` (replaced by lighter `cover_scope`), `discipline_review`, `critic`, `dedupe`, `verify`, `challenger`. Commercial chain is unchanged.

## The two stages that do the work

### 1. `cover_scope` (new, replaces `dna_extract` for residential)

One AI call against the cover sheet + index sheet only. Outputs a small JSON blob:

```text
{
  building_type, stories, conditioned_sf, has_garage, has_pool,
  hvhz, wind_speed, exposure, climate_zone, scope_notes
}
```

Written to `project_dna` (reusing existing columns) so downstream UI keeps working. No persona, no failure-mode brainstorming — pure extraction.

### 2. `checklist_sweep` (new, replaces `discipline_review` for residential)

Deterministic loop over the residential rows in `discipline_negative_space` (the ~41 FBCR items we already seeded). For each checklist item:

1. Pull the 1-3 most likely sheets for that item (from `sheet_coverage` discipline mapping — e.g. R310 EERO → Architectural floor plans; R602.10 braced walls → Structural).
2. One narrow AI call: *"Looking ONLY at these sheets, is FBCR §X complied with? Answer: compliant / deficient / not_visible. If deficient or not_visible, write a one-sentence finding."*
3. Insert the result as a finding tagged with that checklist row id, `requires_human_review=true` for `not_visible`.

This guarantees:
- **One finding per checklist item, max.** No fan-out, no duplicates, nothing to dedupe.
- **Every checklist item gets a verdict** — the human always sees the full FBCR list, not whatever the model felt like raising.
- **No hallucinated topics** — the model can't invent items not on the checklist; it only judges items we hand it.

Because findings already carry the FBCR section from the checklist row, `ground_citations` becomes a trivial deterministic check (no vector fallback needed).

### 3. Stages we drop for residential and why

- `discipline_review`: replaced by checklist_sweep. The 5 expert personas were the main hallucination source.
- `critic` / `verify` / `challenger`: these existed to second-guess freeform findings. Checklist findings are pre-scoped — second-guessing adds latency and noise.
- `dedupe`: nothing to dedupe when each checklist item produces ≤1 finding.
- `callout_graph`: useful for multi-trade commercial sets; on a 12-sheet SFR it adds no signal.
- `dna_extract`: replaced by lighter `cover_scope`. The full DNA extractor pulls ~40 fields tuned for commercial; we only need ~10 for residential.

## Cost / latency impact

Today a residential run is ~5 experts × ~3 chunks × ~$0.04 + critic + verify + challenger ≈ **~$1.20 and 4-7 min**. New chain is `cover_scope` (1 call) + `checklist_sweep` (~41 cheap calls, batchable to ~8) + `ground_citations` (deterministic) ≈ **~$0.25 and 60-90 sec**.

## UI side — the board

The review dashboard board currently groups findings by discipline. For residential we'll add a simple toggle that defaults to **"Checklist view"**: rows are the FBCR checklist items in a fixed order (R301 → R314 → R401 → R602 → R703 → R802 → R903 → N1101 → P/E), each row showing compliant / deficient / verify-on-plan. Discipline view still available but secondary.

Cover-sheet card on the dashboard pulls directly from `cover_scope` output so the reviewer sees the project summary up top before any findings.

## Technical details

**New files**
- `supabase/functions/run-review-pipeline/stages/cover-scope.ts`
- `supabase/functions/run-review-pipeline/stages/checklist-sweep.ts`

**Modified**
- `_shared/types.ts`: add `cover_scope` + `checklist_sweep` to `Stage`; add `RESIDENTIAL_CORE_STAGES` and a `stagesForUseType(mode, useType)` helper.
- `index.ts`: dispatch on `useType` when picking the chain.
- `discipline-review.ts`: leave commercial path intact; early-return for residential (defensive, since chain won't include it).
- `discipline_negative_space`: add `sheet_hints text[]` column so each checklist row declares which sheet disciplines/keywords to inspect (e.g. R310 → `["Architectural"]`, plus title-keyword `["floor plan","bedroom"]`).
- `ground-citations.ts`: short-circuit for residential findings that already carry an FBCR section from the checklist row.
- New small UI: "Checklist view" tab on the review board (FindingsListPanel) — groups by `checklist_item_id` instead of discipline when `useType==='residential'`.

**Deferred (not in this pass)**
- FBCR full-text seed in `fbc_code_sections` (titles already exist; bodies later)
- AI learning loop changes
- Commercial pipeline simplification (separate effort)

**Backward compat**: Commercial chain, personas, and all existing stages untouched. Existing in-flight residential runs finish on the old chain; only new runs use the simplified one.

## Implementation order on approval

1. Schema: add `sheet_hints` column + backfill the 41 residential rows with sensible hints.
2. `cover_scope` stage + wire into chain.
3. `checklist_sweep` stage + batched AI calls.
4. `stagesForUseType` dispatch in `index.ts`.
5. Checklist view tab on the review board.
6. Smoke test on a real residential set, compare findings against the FBCR checklist.
