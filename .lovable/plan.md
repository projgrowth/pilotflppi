# Plan Review: Precision, Trust, and Lifecycle Hygiene

A blocked-down list of what's standing between the current pipeline and a private-provider-grade review experience, plus the timestamp/delete features you called out. Items are tagged **P0** (blocks pilot trust), **P1** (lifts precision/UX meaningfully), **P2** (polish).

---

## Part A — What's preventing a "properly reviewed" plan

### 1. Code grounding still has gaps (P0 — precision)
Today `ground_citations` matches AI findings to `fbc_code_sections` via vector similarity, but:
- Many sections in the canonical library are stub text ("see FBC for full requirement text") — graders mark grounded, but the comment letter cites filler. We already flag these in `flag_findings_for_reground_on_canonical_change`, but findings citing stub sections still ship.
- No required-edition matching. A 7th-edition citation can ground to an 8th-edition section silently.
- **Fix:** (a) hard-block any finding from "grounded" status if `requirement_text` is shorter than 60 chars or contains "see FBC"; (b) require `edition` agreement with the project's `fbc_edition` (already on `jurisdictions_fl`); (c) surface ungrounded findings in a "Citations need a human" tray inside the workspace, separate from low-confidence.

### 2. Sheet → discipline routing is the single biggest accuracy lever (P0)
`discipline-review.ts` runs per discipline against `disciplineSheets` resolved by `sheet_map` + `disciplineForSheetFallback`. If `sheet_map` mis-tags an A-sheet as M, the structural reviewer never sees it and the mechanical reviewer hallucinates.
- **Fix:** add a quick "sheet routing audit" step after `sheet_map` that asks the model to confirm the discipline of each routed sheet using only the title block crop (cheap, ~$0.001/sheet). Disagreements show as a banner with one-click reassignment in the workspace.
- **Fix:** show the user the discipline-by-sheet matrix before the heavy `discipline_review` stage runs — a 10-second sanity check now prevents 5 minutes of wasted findings.

### 3. "Did the AI actually look at every sheet?" is invisible (P0)
We have `SheetCoverageMap` and `AuditCoveragePanel` components but the workspace doesn't gate the comment letter on coverage. A private provider needs a single chip: **"42/42 sheets reviewed by all required disciplines."**
- **Fix:** add a `coverage_pct` to the readiness gate; block "Send letter" if any required discipline missed a sheet that was routed to it. Reviewer can override with a typed reason (already a pattern via `comment_letter_snapshots.override_reasons`).

### 4. No second-pass on high-stakes findings (P1 — precision)
`critic` exists but runs once. For findings with `life_safety_flag` or `permit_blocker`, a single critic pass is too thin for a private provider's signature.
- **Fix:** when a finding is life-safety OR permit-blocker AND grounded confidence < 0.7, queue it through a stricter "challenge" prompt (different model, different framing — "argue this finding is wrong"). If the challenger agrees it stands, mark it `verified_by_challenger=true` and badge it in the UI.

### 5. Submittal completeness is advisory, not enforced (P1)
`submittal-check` runs but the pipeline continues even when submittal is incomplete. Reviewing an incomplete set wastes AI spend AND produces findings the contractor will (rightfully) dispute.
- **Fix:** add a firm setting `block_review_on_incomplete_submittal` (default off so existing flows aren't broken). When on, incomplete submittal halts at `submittal_check` with a clear list of missing items the contractor can re-upload against.

### 6. No "why this finding?" provenance for the contractor (P1 — trust)
`FindingProvenancePopover` exists internally. The exported comment letter PDF doesn't include the evidence crop or the routed sheet thumbnail. Private providers live or die by defensibility.
- **Fix:** add an optional "Evidence appendix" to the letter PDF — one page per finding with the cropped evidence, sheet ref, and the canonical code text. Toggle in the export dialog; default on for Florida private-provider firms.

### 7. Re-review (round 2+) doesn't diff against round 1 (P1)
Resubmitted plans currently run a fresh pipeline. The contractor expects "Items 3, 7, and 12 from round 1 are now resolved; items 5 and 9 are not."
- **Fix:** after `dedupe`, run a `round_diff` stage that links new-round findings back to prior-round `lineage_id`s already on `deficiencies_v2`. Mark each prior finding as `resolved | unresolved | partially_resolved | new`. Surface in `RoundCarryoverPanel` (already exists) and prepend it to round-2 letters.

### 8. AI-extracted DNA is never re-confirmed by the human (P2)
`dna_extract` pulls building height, occupancy, construction type, etc. — these drive every downstream check. If occupancy is wrong, every life-safety finding is suspect.
- **Fix:** when a review hits `dna_extract` complete, surface a 30-second "Confirm project DNA" card in the workspace before opening up `discipline_review` results. One click confirms; any edit cascades a `re-ground` of affected findings.

### 9. Cost & timing per review is opaque to the firm owner (P2)
`CostTimingPanel` shows aggregate. No per-review "this review cost $0.42 and took 3m 12s." Pilots want to model unit economics.
- **Fix:** add a small cost/time chip to the workspace header and to each row on Projects.

---

## Part B — Pipeline & Projects pages: timestamps, deletes, lifecycle

### 10. Timestamps everyone needs (P0 — your ask)
Currently:
- Projects list shows "Xd left" but not "uploaded 3h ago" or "last activity 12m ago."
- Pipeline Activity shows "elapsed" only on the running stage.

Add to **Projects list rows**:
- `Uploaded` (= earliest `plan_review_files.uploaded_at` for that project) — shown as "3h ago" with full timestamp on hover.
- `Last action` (= latest of: `plan_reviews.updated_at`, latest pipeline row `updated_at`, latest `finding_status_history.changed_at`) — same format.
- New sortable column "Last activity" (default desc).

Add to **Pipeline Activity rows**:
- `Started` and `Last update` timestamps next to the stepper.
- Total wall-clock duration when complete.

### 11. Delete plans / files with confirmation (P0 — your ask)
The codebase already has `useConfirm` (with "Don't ask again this session" option) and a `cleanup-orphan-uploads` edge function — we just need to wire it.

**Per-file delete** in `PlanViewerPanel`:
- Hover-action trash icon on each `plan_review_files` row.
- Confirms via `useConfirm` (destructive variant, not remembered — files are unrecoverable).
- Removes from storage `documents` bucket AND from `plan_review_files`. Logs to `activity_log`.

**Per-plan-review delete** in workspace top bar (`ReviewTopBar`) + Projects row hover:
- Cascade: delete `plan_review_files` (storage + table), `deficiencies_v2`, `review_pipeline_status`, `comment_letter_snapshots` for that review, then the `plan_reviews` row.
- Block deletion if `comment_letter_snapshots` has a `sent_at` (legal record). Owner-only override with typed reason → soft-deletes (`deleted_at`) instead of hard delete.
- Confirm dialog requires typing the project name (the "Don't ask again" option is hidden — too destructive to ever skip).

**Per-project delete** in Projects row hover + ProjectDetail:
- Same pattern but cascades all reviews, inspections, invoices line items, etc.
- Hard-block if any `certificates_of_compliance` exist. Soft-delete only.

**DB changes:**
- Add `deleted_at timestamptz` to `plan_reviews`, `projects`, `plan_review_files`. Filter all list queries by `deleted_at IS NULL`.
- Add admin-only "Trash" view on Settings > Data so owners can restore within 30 days.
- New edge function `delete-plan-review` that handles the cascade with service role + verifies the user is firm member with admin role.

### 12. "Cancel a stuck review" already exists but is hidden (P1)
`cancelPipelineForReview` works on the Pipeline Activity page but not from the workspace. Add a Cancel button to the workspace header when any stage is `running` or `pending`. Same `useConfirm` dialog.

### 13. Auto-purge orphans on a schedule (P1)
`cleanup-orphan-uploads` exists but runs ad-hoc. Add a daily cron (Supabase scheduled function) that cleans:
- Storage objects under `plan-review-files/` with no matching `plan_review_files` row > 24h old.
- `review_pipeline_status` rows in `pending` > 24h with no `started_at`.

### 14. Lifecycle audit log surfaced to the user (P2)
`activity_log` already records most things. Add an "Activity" tab to ProjectDetail and PlanReviewDetail that renders the project's events as a timeline. Private providers will be asked to produce one in audits.

---

## Recommended sequencing

**Pilot-blocker batch (do first, ~1 day):**
- 10 Timestamps on Projects + Pipeline Activity
- 11 Delete (file → review → project) with confirmations + soft-delete column
- 1 Citation grounding hard-blocks (stub text + edition mismatch)
- 3 Coverage gate on letter send

**Precision batch (next, ~1 day):**
- 2 Sheet routing audit + reassignment UI
- 4 Challenger pass on life-safety findings
- 6 Evidence appendix in letter PDF
- 7 Round-diff stage

**Polish batch:**
- 5 Submittal-block firm setting · 8 DNA confirm card · 9 Per-review cost chip · 12 Workspace cancel · 13 Daily cleanup cron · 14 Activity timeline

---

## Technical notes

**New DB:**
- `ALTER TABLE plan_reviews/projects/plan_review_files ADD COLUMN deleted_at timestamptz`
- `ALTER TABLE deficiencies_v2 ADD COLUMN verified_by_challenger boolean DEFAULT false, round_diff_status text` — values: `new | resolved | unresolved | partially_resolved`
- Update RLS: list policies filter `deleted_at IS NULL`; delete policy on `plan_reviews` allows authenticated firm member (soft) or admin (hard).
- Scheduled function `cron-cleanup-orphans` (daily 3am ET).

**New edge functions:**
- `delete-plan-review` (cascade, service-role, idempotent)
- `delete-project` (cascade, requires no issued CoC)

**New / modified components:**
- `src/components/DeleteConfirmDialog.tsx` (typed-name confirm)
- `src/lib/delete-plan-review.ts`, `src/lib/delete-project.ts`
- `src/pages/Projects.tsx` — add Uploaded/Last activity columns, row-hover trash
- `src/pages/PipelineActivity.tsx` — Started/Last update timestamps, wall-clock duration
- `src/components/plan-review/PlanViewerPanel.tsx` — per-file trash with confirm
- `src/components/plan-review/ReviewTopBar.tsx` — Cancel + Delete review actions
- `src/pages/ProjectDetail.tsx` — Activity tab, Delete project (soft)
- New `stages/sheet-routing-audit.ts`, `stages/round-diff.ts`, `stages/challenger.ts`
- `src/components/plan-review/SheetRoutingAuditBanner.tsx`
- `src/components/plan-review/DnaConfirmCard.tsx`
- `src/lib/letter-readiness.ts` — add `coverage_pct` and `ungrounded_count` gates

Confirm and I'll execute the pilot-blocker batch first; precision/polish in follow-ups so each batch is reviewable.