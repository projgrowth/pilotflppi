## Plan-Review Legitimacy Audit

I scanned the pipeline, the schema, and a sample of real production data. There are real cracks a building official (or a plaintiff) could exploit. Ranked by severity.

---

### 🔴 P0 — Statute / Defensibility Failures

**1. Statutory deadline math disagrees between server and client.**
The Postgres function `compute_statutory_deadline()` (which writes `projects.statutory_deadline_at`) only skips weekends.
The client lib `src/lib/statutory-deadlines.ts` skips weekends **and** Florida state holidays (MLK, Memorial Day, Juneteenth, etc.).
Result: the deadline shown to the reviewer in the UI can be several days different from the deadline stored in the database — and the database value is what alerts/auto-hold trigger off. F.S. 553.791(4) is explicit that holidays are excluded.
**Fix:** rewrite `compute_statutory_deadline` in SQL to consult a Florida holiday set, OR drop the SQL helper entirely and compute deadlines in one place (the trigger calls a SECURITY DEFINER fn that wraps the same logic). Single source of truth.

**2. Evidence crops never get generated.**
Production data: **0 of 320 live findings have `evidence_crop_url` set.** The "click finding → see the visual receipt" feature that the dashboard advertises is dead. The pipeline schema has `evidence_crop_url` and `evidence_crop_meta` columns and the UI renders them — but no stage actually fills them. The `quality_score` formula in `complete.ts` awards 20/100 points for "≥80% have crops"; every review currently scores zero on that band.
**Fix:** add a `crop_evidence` stage (or fold into `verify`) that calls `pdf-utils.renderZoomCropForCell` on the cited sheet + bbox returned by the AI and uploads to `documents/plan-reviews/<id>/crops/<def_id>.jpg`.

**3. 62% of findings have no verbatim plan-text evidence.**
200 of 320 live findings have an empty `evidence` array. Discipline-review prompt requires `evidence: [...]` but doesn't reject the finding if the array is empty. So the AI raises generic comments with no quotation hooked back to the document — exactly what AHJs reject as "boilerplate."
**Fix:** in `discipline-review.ts`, drop any returned finding where `evidence.length === 0` OR auto-route it to `requires_human_review` with reason `"no verbatim evidence"`. Tighten the function-schema description with "MUST quote at least one phrase from the sheet."

**4. The verifier almost never runs to completion.**
Production data: 183 findings stuck at `verification_status='unverified'`, only 8 `verified`. The `verify` stage exists but most reviews complete without findings reaching a verdict. That breaks the "two reviewer principle" the dashboard presents to the AHJ.
**Fix:** make `complete` stage refuse to flip `ai_check_status='complete'` when >25% of findings are still unverified — instead set `ai_check_status='needs_human_review'` with a clear blocker message. Add a post-complete watchdog that re-queues `verify` if it bailed early.

---

### 🟠 P1 — Audit Trail / QC Gaps

**5. QC sign-off has zero adoption and no path to actually sign off.**
21 of 21 completed reviews are stuck at `qc_status='pending_qc'`. The readiness gate treats "QC sign-off" as a required check (downgraded to a warn for sole signers) — but the data shows nobody is approving anything. There is no "Mark QC Approved" button in the UI today.
**Fix:** add a `QcApprovalCard` on the Review Dashboard with: who signed, when, free-text concurrence note. Stamp `qc_status='qc_approved'`, `qc_approved_by`, `qc_approved_at` (column missing — needs migration). Without this, the entire two-pair-of-eyes story is theatre.

**6. Reviewer triage is essentially never done.**
319 of 320 live findings have `reviewer_disposition=NULL`. The "Triage complete" readiness check is therefore always failing — yet letters keep getting marked sent. Either the readiness gate is being overridden silently or the disposition write path is broken.
**Fix:** add an audit trail: every "Send anyway" override must persist `override_reasons` (column already exists in `comment_letter_snapshots`) AND insert an `activity_log` row with `event_type='readiness_override'`. Make the override require typing the reason, not just a checkbox.

**7. Comment-letter snapshots are never being created.**
0 rows in `comment_letter_snapshots`. The whole sealed/hashed letter chain-of-custody we built is unused — that means there is no proof of what the AHJ actually received for any review currently in the system.
**Fix:** the "Mark Sent" button must be wired to write a snapshot row before flipping the review status. Right now it only updates plan_reviews. Add the call site + a unit test that sending without a snapshot row throws.

**8. AI cost / model-version provenance not stamped on findings.**
`deficiencies_v2.model_version` and `prompt_version_id` are nullable and almost certainly empty. Without that, you cannot answer the AHJ question "what AI/version produced this finding?" — which is the first thing a sophisticated official will ask.
**Fix:** in every AI call site, write `model_version` and `prompt_version_id` (already cached in `_promptVersionCache`) onto each finding row at insert time. Backfill once for old rows.

---

### 🟡 P2 — Polish / Trust Signals

**9. Hallucinated citations exist in production but the gate doesn't fire.**
20 findings carry `citation_status='hallucinated'` and 97 are `mismatch`. `complete.ts` records "has_hallucinated_citations" in the quality breakdown but does NOT block the letter. A reviewer can send a letter to the AHJ that cites code sections that don't exist.
**Fix:** add a `no_hallucinated_citations` check to `letter-readiness.ts` as **required** (block, not warn). Reviewer must explicitly disposition each one (`accept_with_correction` / `reject`) before sending.

**10. Inspection tables are empty — Sprint 4 isn't actually exercised.**
0 rows in `required_inspections`, `inspection_reports`, `certificates_of_compliance`. The auto-seed in `RequiredInspectionsPanel` only fires when DNA is present. We should either remove the inspection tab from nav until a project is past `permit_issued`, or seed reasonable defaults so reviewers can see what the workflow looks like.
**Fix:** small — gate the Inspections nav item on `project.status >= permit_issued`, OR add demo seed for the test firm.

**11. Reviewer-license check is one-way.**
The readiness gate blocks if the reviewer is not licensed in a discipline that appears in the letter — good. But it doesn't block when the reviewer signs a project DNA outside their license either. A Florida AR cannot stamp structural calcs.
**Fix:** check `reviewerLicensedDisciplines ⊇ disciplinesInLetter` AND mirror the same guard at AI-check kickoff (`useAILearningStats`/`runAICheck` entry).

**12. AI learning loop has no feedback yet.**
8 correction patterns exist, all with `confirm_count=0`. The `process-correction` edge function is wired but no UI surfaces "this pattern matched, confirm?" so patterns never strengthen. The `applied_corrections` table has 87 rows so we know matches are happening — they just aren't being confirmed.
**Fix:** add an inline "✔ This was helpful / ✘ Wrong match" pair on each `FindingProvenancePopover` so a one-click confirms or rejects the matched pattern.

---

### What this plan would change

| File / area | Change |
|---|---|
| `supabase/migrations/...statutory_holiday_table.sql` | New SQL function with FL holiday set; fix `compute_statutory_deadline`; add `qc_approved_by/at` columns |
| `supabase/functions/run-review-pipeline/stages/crop-evidence.ts` | New stage — render & upload zoom crops |
| `supabase/functions/run-review-pipeline/stages/discipline-review.ts` | Reject findings with empty `evidence[]`; stamp `model_version` + `prompt_version_id` |
| `supabase/functions/run-review-pipeline/stages/complete.ts` | Block completion when >25% unverified or any hallucinated; require all findings dispositioned |
| `src/lib/letter-readiness.ts` | New required check `no_hallucinated_citations`; license-discipline guard at AI kickoff |
| `src/components/plan-review/QcApprovalCard.tsx` | New component — QC sign-off UI |
| `src/pages/ReviewDashboard.tsx` | Wire QC card; ensure "Mark Sent" always writes a `comment_letter_snapshots` row + activity log |
| `src/components/review-dashboard/FindingProvenancePopover.tsx` | Pattern confirm/reject buttons |
| `src/components/AppSidebar.tsx` | Gate `/inspections` nav on project status |

Approve to execute. I'll do P0+P1 in one sprint and P2 as polish at the end.