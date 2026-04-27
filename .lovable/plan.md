## Track 3 — Reviewer-side reliability: from AI output to a letter you'll sign

Tracks 1 and 2 made the AI output trustworthy (FBC-grounded citations, real evidence thumbnails). The biggest remaining gap is the **reviewer's path from "AI finished" to "letter sent to the state"**. Today the dashboard shows findings and lets a reviewer accept/reject, but there's nothing stopping someone from exporting a letter that:

- still has open low-confidence findings nobody triaged,
- has citations marked `unverified`,
- has unresolved sheet references,
- was never QC'd,
- can't be re-opened later because nothing was snapshotted.

Track 3 closes those gaps without changing the AI itself.

### Problems being fixed

1. **No "ready to send" gate.** `CommentLetterExport` will print a PDF whether or not findings are triaged or QC'd. Reviewers can accidentally send half-reviewed letters.
2. **Triage is per-finding only — no batch sanity check.** On a 60-finding job there's no single view of "what's left to decide."
3. **No immutable snapshot at send time.** When a contractor resubmits 3 weeks later, we can't prove what the round-1 letter actually said — `comment_letter_draft` is just live text and findings can be edited after the fact.
4. **No "stuck pipeline" recovery for the reviewer.** If `run-review-pipeline` errors mid-stage, the user sees the stepper stalled but has no one-click retry from the dashboard (only the existing background `reconcile-stuck-reviews` cron).
5. **No reviewer activity trail on individual findings.** `finding_status_history` exists but isn't surfaced anywhere — reviewers can't see "who changed this from open to confirmed and why."

### What we'll build

**1. Pre-send readiness check (blocking)**

New component `LetterReadinessGate` shown above the export button in `CommentLetterExport.tsx` and as a section in `NextStepBar`. It computes a checklist from live data:

- All non-deferred findings have a `reviewer_disposition` (confirm / reject / modify).
- Zero findings with `citation_status = 'unverified'` AND `confidence_score < 0.7`.
- Zero findings with `evidence_crop_meta.unresolved_sheet = true` that are still `open`.
- `qc_status = 'qc_approved'` (unless reviewer is also the QC sign-off — single-reviewer firms).
- Project DNA has no `missing_fields` flagged as critical.

Each row is green/amber/red with a "Jump to" link. Export PDF and "Mark sent" buttons are disabled until all required rows are green. An "Override and send anyway" requires a typed reason that gets logged to `activity_log`.

**2. Snapshot on send — immutable letter record**

New table `comment_letter_snapshots`:
```text
id, plan_review_id, round, firm_id,
sent_at, sent_by, recipient (text),
letter_html (text),                  -- exact rendered HTML at send time
findings_json (jsonb),               -- frozen array of findings with
                                     --   id, def_number, finding, required_action,
                                     --   code_reference, evidence_crop_url,
                                     --   evidence_crop_meta, sheet_refs, status
firm_info_json (jsonb),              -- frozen firm letterhead at send time
override_reasons (text),             -- non-null if readiness gate was overridden
pdf_storage_path (text),             -- optional rendered PDF
created_at
```
RLS: firm-scoped. Insert-only for reviewers; no updates, no deletes (deletes restricted to admin).

A new "Mark sent" button writes the snapshot, sets `plan_reviews.qc_status = 'sent'`, and triggers the existing `reset_review_clock_on_resubmission` flow on the next round. The dashboard then shows "Round 1 letter sent on Apr 12 — view snapshot" for full audit.

**3. Triage Inbox upgrade — "what's left" view**

`TriageInbox.tsx` already exists. We'll add:
- A "Needs decision" filter that shows only findings without a disposition.
- Keyboard-driven workflow (already partly there in `TriageShortcutsOverlay`): J/K to move, C to confirm, R to reject, M to modify, D to defer, ?/H for help.
- A persistent counter at the top: "12 of 47 triaged · 35 left" so reviewers know exactly how much work remains.
- "Triage all by AI confidence" — bulk-confirm all findings with `confidence_score ≥ 0.9` AND `citation_status = 'verified'` in one click, with a confirm dialog showing the count.

**4. Stuck-pipeline recovery (user-initiated)**

In `StuckRecoveryBanner.tsx`, surface a "Retry from last successful stage" button that calls `run-review-pipeline` with `{ resume_from: <last completed stage> }`. The edge function already has stage checkpointing in `stage_checkpoints` — we just need to expose it. Banner shows when:
- Last `pipeline_error_log` entry is < 30 min old, OR
- A stage has been `running` for > 5 min with no checkpoint update.

**5. Per-finding history popover**

`FindingProvenancePopover` already shows AI provenance. Add a second tab "Reviewer activity" that reads from `finding_status_history` for that finding's id and shows a vertical timeline: "Apr 12 14:22 — Sarah marked confirmed", "Apr 12 14:30 — Sarah added note 'verified on sheet A-201'". This is the trail a state inspector or auditor needs.

### Files to create

- `src/components/plan-review/LetterReadinessGate.tsx` — the blocking checklist.
- `src/lib/letter-readiness.ts` — pure function that computes the readiness checklist from `findings + qc_status + project_dna`.
- `src/components/plan-review/LetterSnapshotViewer.tsx` — read-only viewer for past sent letters.
- `supabase/migrations/<ts>_comment_letter_snapshots.sql` — new table + RLS.

### Files to edit

- `src/components/CommentLetterExport.tsx` — wire the gate, add "Mark sent" → snapshot insert.
- `src/components/review-dashboard/NextStepBar.tsx` — add a "Letter not ready: X items left" step when gate fails.
- `src/components/review-dashboard/TriageInbox.tsx` — "Needs decision" filter, counter, "Triage by AI confidence" bulk action.
- `src/components/plan-review/StuckRecoveryBanner.tsx` — add user-initiated retry button.
- `src/components/review-dashboard/FindingProvenancePopover.tsx` — add "Reviewer activity" tab.
- `supabase/functions/run-review-pipeline/index.ts` — accept `{ resume_from }` query param and skip stages already in `stage_checkpoints`.

### What this does NOT change

- No changes to the AI prompts, models, or extraction logic — Tracks 1 + 2 already covered that.
- No changes to billing, projects, inspections, or contractor portal.
- No new external secrets needed.

### Outcome

After Track 3, a reviewer cannot accidentally send a half-reviewed letter, every sent letter is immutably archived with its exact findings + evidence at send time, the triage workflow has a clear "X left to decide" counter, and any stuck pipeline can be retried from the dashboard with one click. This is the layer that takes the tool from "AI gives me good findings" to "I'm comfortable signing this and sending it to the state."

Approve and I'll implement Track 3.