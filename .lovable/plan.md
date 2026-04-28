## Backend audit findings

Scope: 10 edge functions (~3,300 lines), 41 public tables, 30 migrations, all DB functions/triggers/policies, and every client → backend touchpoint.

The codebase is in good shape overall — RLS is enabled on every table, the pipeline is properly modularized, multi-tenancy via `firm_id` is consistent. But there are real correctness, cost, and Florida-Statute-553.791-defensibility gaps that will bite a paying private-provider firm.

---

## 1. Dead / unused code to delete

### A. `supabase/functions/ai/index.ts` — 5 dead actions (~250 lines)
Verified by `rg` — no client invokes these:
- `plan_review_check` and `plan_review_check_visual` — fully replaced by `run-review-pipeline`/`stages/discipline-review.ts`
- `generate_comment_letter` — letter is now built deterministically client-side (`src/components/CommentLetterExport.tsx`)
- `generate_inspection_brief` — no caller
- `refine_finding_pin` — pin refinement was removed when deterministic pin placement (mem://logic/pin-placement) replaced it

Keep: `extract_project_info`, `extract_zoning_data`, `fbc_county_chat`, `answer_code_question`, `generate_outreach_email`, `generate_milestone_outreach`. Also delete `PLAN_REVIEW_TOOL` schema and prune `MULTIMODAL_ACTIONS`/`TOOL_CALL_ACTIONS` maps.

### B. Legacy `public.deficiencies` table (25 stale rows)
`deficiencies_v2` is the active table. The only file touching v1 is `src/hooks/useReviewData.ts`. Remove the hook + drop the v1 table (or keep table read-only behind a deprecation comment).

### C. Empty/never-written tables
- `ai_outputs` (0 rows, 0 inserts in code) → drop
- `review_flags` (0 rows, no callers found) → drop
- `statutory_alerts` (0 rows, no callers found) → drop
- `review_feedback` (8 rows but no INSERT in current code; only read by `useAILearningStats`) → keep table, remove the dead read or wire up the missing write

### D. Stage chain redundancy
The pipeline runs `critic` (text-only triage), then `verify` (vision-grounded), then `challenger` (adversarial high-stakes). In CORE we run critic + challenger. In DEEP we add verify + cross_check. `verify` and `challenger` overlap heavily — both image-ground a finding and decide upheld/overturned. Consolidate by **collapsing `verify` into `challenger`** (single adversarial vision pass scoped to high-stakes findings) and dropping `verify` from the chain entirely. Saves one model round-trip in DEEP runs and removes ~316 lines.

### E. Misc
- `_shared/types.ts` `disciplineForSheetFallback()` is marked `@deprecated` — confirmed only re-exported, not called. Delete.
- `discipline-experts.ts` exports `DisciplineExpert` interface that no caller imports — keep file but trim unused exports.

---

## 2. Correctness bugs (these break expected behavior)

### Bug 1 — `firm_settings` keyed by `user_id`, not `firm_id`
`firm_settings.user_id` is unique per row but the table holds **firm-wide** settings (block thresholds, letterhead, jurisdictions). When a firm has 2+ members and the non-owner runs the pipeline, `index.ts:226` tries to look up by `user_id = firmId` (a UUID mismatch), then falls back to "any row in the firm" via `.limit(1)` — which silently picks the wrong firm in a multi-tenant world. Same bug bites letter-generation gates (`block_letter_on_low_coverage`).

Fix: add `firm_id` column to `firm_settings`, backfill from the owner row, switch all reads to `.eq("firm_id", firmId)`. Tighten RLS to firm-membership. Remove the `.limit(1)` fallback.

### Bug 2 — `match_fbc_code_sections` cannot succeed today
504 canonical FBC rows, **0 with embeddings**. `ground_citations` calls `vectorSuggestSection()` which always returns `null`, so every "mismatch" finding silently degrades to `verified_stub`. The result: the citation grounding stage is mostly cosmetic.

Fix: invoke `embed-fbc-sections` (already exists, with a CanonicalCodeLibrary UI) at deploy time, or schedule it via cron. Also gate `ground_citations` on at least N% canonical hydration so we don't pretend to verify against stubs.

### Bug 3 — No cron for `check_deadline_alerts` or `reconcile-stuck-reviews`
The DB function and the edge function exist and were designed to run on a schedule, but only `cleanup-orphan-uploads` is scheduled (`20260428184028_*`). Statutory deadline alerts (Florida 30-day clock — mem://logic/permit-deadline-tracking) and stuck-pipeline auto-recovery are dormant.

Fix: add two `cron.schedule` entries:
- `check_deadline_alerts` every 15 min via `SELECT public.check_deadline_alerts();`
- `reconcile-stuck-reviews` every 5 min via `pg_net` POST

### Bug 4 — `cost_metric` rows accumulate forever
`cleanup-orphan-uploads` retention purges `chunk_summary`, `stuck_no_progress`, `storage_cleanup` from `pipeline_error_log` after 90 days but **not** `cost_metric`. With ~30 plan reviews already and >100 AI calls each, this table will balloon.

Fix: include `cost_metric` in the retention `IN(...)` list (keep 30 days for cost rows, 90 for the rest).

### Bug 5 — `auto_advance_project_status` overwrites manual status
The trigger force-sets `status='comments_sent'` whenever `ai_check_status` flips to `complete`, even if a reviewer has already moved the project past that stage (e.g. to `resubmitted`). Re-running AI on a re-submission rewinds the project status.

Fix: only advance when `current_status IN ('intake','plan_review')` AND no `comment_letter_snapshots` row exists yet for the current round.

### Bug 6 — `prepare-pages` stage cannot rasterize on the server
The orchestrator throws `NEEDS_BROWSER_RASTERIZATION` because Deno edge runtimes can't run MuPDF. This is by design, but it means **any review whose browser-side prep failed is permanently blocked** until a user opens the dashboard and clicks "Re-prepare". For a private-provider production system this is a sharp edge.

Fix: add a queued worker option using `@unpdf/pdfjs` (works in Deno) or a small Cloudflare Worker — at minimum, surface a clear status banner so AHJ-facing users aren't blindsided.

### Bug 7 — `flag_findings_for_reground_on_canonical_change` is a trigger but no triggers are registered
DB shows "There are no triggers in the database" yet `flag_findings_for_reground_on_canonical_change`, `clear_fbc_embedding_on_text_change`, `auto_advance_project_status`, `auto_manage_statutory_clock`, `set_inspection_clock_on_schedule`, `reset_review_clock_on_resubmission`, `set_firm_id_from_user`, `set_firm_id_from_plan_review`, `handle_new_user`, `update_updated_at_column` all exist as TRIGGER functions. They are orphaned — no `CREATE TRIGGER` statements ever attached them. Multi-tenancy auto-population, statutory-clock automation, and re-grounding on canonical edits are all silently inert.

Fix: a single migration that creates all the missing triggers. This is the highest-impact one-line-per-trigger fix in the audit.

---

## 3. Security warnings (Supabase linter, 26 issues)

- **Extension in public schema** (pgvector) — low risk, document and ignore
- **24 SECURITY DEFINER functions exposed via PostgREST** — most are pgvector internals; the project-owned ones (`has_role`, `user_firm_id`, `compute_statutory_deadline`, `is_fl_state_holiday`, `check_deadline_alerts`, `match_*`, `generate_invoice_number`) should each have `REVOKE EXECUTE ... FROM anon` and explicit `GRANT EXECUTE ... TO authenticated` where they're meant to be callable.

Fix: one migration revoking blanket `anon` execute on all custom SECURITY DEFINER functions, then granting to `authenticated` only where the client legitimately calls them (`has_role`, `match_fbc_code_sections`, `match_correction_embeddings`, `generate_invoice_number`).

---

## 4. FBC / private-provider standards gaps

These are not bugs — they are missing capabilities a Florida private provider needs to operate defensibly under F.S. 553.791:

1. **Audit trail for licensee responsibility (553.791(5))** — every comment letter and Certificate of Compliance should be cryptographically chained back to the licensed plan reviewer who signed it. We have `chained_hash` on `certificates_of_compliance` but no chained hash on `comment_letter_snapshots`. Add it + a verification UI.

2. **Statutory 30-business-day clock with explicit pause/resume reasons** — `auto_manage_statutory_clock` only pauses on `comments_sent`. It does not record *who* paused it or *why*, which the AHJ may demand. Add `clock_event_log` table.

3. **Required-inspections matrix per occupancy** — the `required_inspections` table exists but is not seeded per occupancy/scope. Without it, the system cannot tell a contractor which milestones they owe.

4. **F.S. 553.791(8) duplicate-review prohibition** — the AHJ must not re-review what the private provider has signed off on. The CoC export should explicitly assert this with the statute reference (today the export only lists findings).

5. **Wind-load + HVHZ enforcement** — DNA extraction reads `hvhz` and `wind_speed_vult` but no stage *fails* the pipeline if a Miami-Dade/Broward project lacks NOA references on product approvals. Add a discipline-aware mandatory check in `submittal-check`.

6. **Threshold building special inspector (F.S. 553.79(5))** — projects >50 ft tall or >5,000 occupants require a special inspector. Not modeled anywhere.

7. **Insurance / E&O surfacing** — F.S. 553.791(20) requires private providers carry minimum $1M E&O. `firm_settings` has no place to record this; the comment letter export should print the policy number for AHJ defensibility.

8. **Re-review rounds vs. sealed-record retention** — F.S. 553.791(15) requires the private provider retain plan-review records for the life of the structure + 10 years. There is no archival policy or export-bundle generator. At minimum add an "Archive review" action that bundles all snapshots + evidence crops into a single signed ZIP in storage.

9. **Email/letter delivery is not tracked** — `comment_letter_snapshots.sent_to_ahj_at` exists but nothing writes it. The Resend / SMTP integration that should mark letters as delivered is missing entirely.

10. **No SOC2-friendly read-only reviewer role** — `app_role` enum has `admin`, `reviewer`, etc. but no `auditor` role for an external compliance reviewer. Easy add when convenient.

---

## 5. Suggested execution order (when you approve)

```text
Phase 1 — Safety & correctness (blocking bugs)
  1. Migration: register all 10 missing triggers (Bug #7)
  2. Migration: add firm_settings.firm_id + backfill + RLS update (Bug #1)
  3. Migration: cron schedules for check_deadline_alerts + reconcile-stuck-reviews (Bug #3)
  4. Migration: include cost_metric in cleanup retention (Bug #4)
  5. Migration: REVOKE EXECUTE FROM anon on custom SECURITY DEFINER fns
  6. Migration: fix auto_advance_project_status guard (Bug #5)

Phase 2 — Dead code purge
  7. Delete 5 unused actions + PLAN_REVIEW_TOOL from supabase/functions/ai/index.ts
  8. Drop tables: ai_outputs, review_flags, statutory_alerts, deficiencies (v1)
  9. Remove src/hooks/useReviewData.ts and any v1 references
  10. Collapse stages/verify.ts into stages/challenger.ts; remove from chain
  11. Delete disciplineForSheetFallback() and dead exports

Phase 3 — Stand up missing capabilities
  12. Auto-trigger embed-fbc-sections on canonical-section insert/update; backfill 504 rows now (Bug #2)
  13. Add chained_hash + previous_snapshot_hash to comment_letter_snapshots
  14. Build "Archive review bundle" edge function (F.S. 553.791(15))
  15. Wire letter-delivery tracking via Resend
  16. Add HVHZ NOA gate to submittal-check
  17. Surface E&O policy number in firm_settings + letter export
  18. Add clock_event_log + UI for statutory clock pause/resume reasons
```

Phases are independent. Phase 1 alone restores expected behavior; Phase 2 is pure cleanup; Phase 3 turns this into a system a Florida private provider can defend in a board-of-rules hearing.

---

## Technical notes (for implementation)

- All migrations must use `CREATE TRIGGER ... IF NOT EXISTS` patterns or guarded `DROP TRIGGER IF EXISTS` first to be re-runnable.
- The trigger registration migration is the most surgical: ~30 lines and instantly fixes 5+ silent behaviors.
- The `firm_settings` schema change requires a coordinated client patch (`useFirmSettings.ts`, `ReviewDashboard.tsx`) — bundle into the same migration PR.
- Stage collapse (`verify` → `challenger`) requires updating `STAGES`, `CORE_STAGES`, `DEEP_STAGES`, `stagesForMode`, the `stageImpls` map, and `NON_FATAL_RETRY_STAGES` set; mechanical change but touches one file.
- Embedding backfill: invoke `embed-fbc-sections` with `{limit: 500}` once after deploy; the function is idempotent.

Approve and I'll implement Phase 1 first, then check in before continuing to Phase 2 and 3.