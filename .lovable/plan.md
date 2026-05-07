## Goal

Run a real residential project through the new `RESIDENTIAL_CORE_STAGES` chain end-to-end and confirm:
1. Every one of the 43 active `discipline_negative_space` rows (use_type='residential') gets exactly one verdict.
2. Each finding written to `deficiencies_v2` is tied back to its checklist row via `verification_meta.checklist_item_key`.
3. `sheet_refs` on each finding correspond to sheets that actually exist in `sheet_coverage` for that review (no hallucinated sheet IDs).
4. No findings exist outside the checklist (i.e. no freelance discipline_review output mixed in).

## Why a fresh run is needed

Inspection of the most recent residential review (`99c8f2cc-a67f-4e1b-b2de-6fe2eaeff75f`, 2026-05-07 00:37) shows findings shaped like the **old** discipline_review chain — `DEF-A001…DEF-C008`, no `checklist_item_key` recorded, civil findings on a residential SFR (stormwater, RPZ, FDOT driveway). This review was created seconds before the new pipeline was deployed, so `checklist_sweep` has never actually run against a residential project. We cannot validate the design without triggering it.

## Verification plan

### Step 1 — Trigger a fresh run on an existing residential project

Reuse project `4cd5f44b-ea09-4952-af4f-eae0a84b9958` ("Legion Construction - New Residence", use_type=residential, already has uploaded sheets). Either:
- create a new `plan_reviews` row pointing at the same `file_urls`, or
- call the `run-review-pipeline` edge function directly via `supabase--curl_edge_functions` with `{ plan_review_id, mode: "core" }`.

Watch `ai_run_progress.checklist_sweep_summary` populate. Expected runtime 60–90s.

### Step 2 — Validate verdict coverage

Query:
```sql
select count(*) from discipline_negative_space
  where use_type='residential' and is_active=true;             -- expect 43

select ai_run_progress->'checklist_sweep_summary' from plan_reviews
  where id = <new id>;
-- expect total_items = 43, and compliant+deficient+not_visible+not_applicable = 43
```

### Step 3 — Validate each finding maps to a checklist row

```sql
select def_number, verification_meta->>'checklist_item_key' as item_key,
       verification_meta->>'verdict' as verdict, sheet_refs, finding
from deficiencies_v2 where plan_review_id = <new id>
order by def_number;
```

Pass criteria:
- every row has `verification_meta.checklist_item_key` set
- every row's verdict is `deficient` or `not_visible` (compliant/NA are filtered out)
- every `item_key` matches an `item_key` in `discipline_negative_space`
- no two rows share the same `checklist_item_key` (one finding per item, max)
- every `sheet_ref` appears in `sheet_coverage` for that plan_review_id

### Step 4 — Spot-check three high-stakes items

For Legion residence, manually verify the verdict for:
- `eero` (emergency escape & rescue openings) — should reference an architectural floor plan sheet
- `smoke_alarms` / `co_alarms` — should reference electrical or arch reflected ceiling
- `wind_design_data` — should reference cover/structural notes sheet

If any of these returned `not_visible` despite the data being present on the supplied sheets, log a sheet_hints tuning task.

### Step 5 — Fix anything the run exposes

Likely classes of issues and the targeted fix:

| Symptom | Fix location |
|---|---|
| Item never gets a sheet (sheet_hints don't match this firm's sheet titles) | extend `discipline_negative_space.sheet_hints.keywords` for that row |
| Same item produces a duplicate finding | enforce unique `(plan_review_id, verification_meta->>'checklist_item_key')` in upsert |
| Findings with sheet_refs not in sheet_coverage | filter `out.sheet_refs` against `urlBySheetRef` keys before insert |
| Old discipline_review findings still appearing | confirm `stagesForUseType` resolved to RESIDENTIAL_CORE_STAGES (check `stage_checkpoints`) |
| `not_visible` rate >50% | reduce `MAX_SHEETS_PER_ITEM` cap or improve sheet selection scoring |

### Step 6 — Lock in the contract

After a clean run, add a small assertion at the end of `stageChecklistSweep`:
- assert `verdicts.length === items.length`
- log a structured `checklist_coverage` block to `ai_run_progress` listing any item_keys with no verdict, so future regressions surface immediately.

## Deliverable

A short report back to you with:
- the new plan_review_id and runtime
- the checklist_sweep_summary counts
- the table of (item_key → verdict → sheet_refs) for all 43 items
- any code/seed-data fixes applied as a result
