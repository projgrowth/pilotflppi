# Why Old Projects "Came Back" + FL Private-Provider Readiness Audit

## 1. The "deleted projects came back" mystery — solved

I queried the database directly. Here's what's actually true:

- The activity log shows **only 10 projects have ever been soft-deleted** (one on Apr 28, nine on Apr 29 at 12:23 UTC).
- Every one of those 10 still has `deleted_at` set in the DB right now. None of them have been "restored."
- The `useProjects`, `useProject`, `useAllActivePipelines`, `Dashboard`, `ProjectDetail`, and `PipelineHealthChip` queries all correctly filter `.is("deleted_at", null)`.
- The `Projects.tsx` page invalidates the `["projects"]` cache after a delete, so the list refreshes.

What you're seeing in the list are **~17 older projects from April 22–27 that were never actually deleted** (their `deleted_at` is `NULL` and there's no `project_deleted` activity log entry for them). They predate the soft-delete UI flow we built, or the delete attempt didn't actually fire (e.g., dialog closed before confirm). They've been sitting there the whole time — they didn't "come back."

**Two small fixes worth doing:**

1. **One-time cleanup migration**: soft-delete the obvious leftover test projects (the SUNCOAST PORSCHE / Proper Pizza & Pasta / NEW SINGLE FAMILY HOME duplicates from before Apr 28) so your project list starts clean for real testing. I'll list the exact IDs and let you confirm before running.
2. **Add a "Deleted" filter toggle** on the Projects page so you can see soft-deleted items and restore them if needed — right now there's no way to tell from the UI whether something was ever deleted, which is exactly why this looked mysterious.

## 2. What else can break before this is "legit FL Private-Provider start-to-finish" software

I went through the codebase against F.S. 553.791 (private provider) workflow requirements. Here are the real gaps, ranked by risk:

### High risk (must-fix before live use)

1. **Statutory clock pause/resume audit gaps**
   - `auto_manage_statutory_clock` only fires on `comments_sent` → `resubmitted`. There's no handling for `on_hold` (manual hold), `cancelled`, or contractor-side delays. F.S. 553.791 lets the clock pause for "applicant-caused delay" — we need a `manual_pause` action with reason + activity_log entry, and the held time must be subtracted from `statutory_deadline_at`.
   - `compute_statutory_deadline` recomputes from `start_date + business_days` but doesn't add back accumulated paused time on resume. Long pause → wrong deadline.

2. **Comment letter immutability is enforced but Round-2 chain isn't validated end-to-end**
   - `protect_letter_snapshot_immutable` + `compute_letter_snapshot_chained_hash` are good. But there's no UI surface that shows the round chain, hash verification, or who signed each round. A reviewer needs to prove "this is round 2, here's round 1's hash" during an audit.
   - No verification job confirms `letter_html_sha256` still matches stored `letter_html` (drift detection).

3. **Certificate of Compliance gating**
   - `delete-project.ts` blocks delete when an active CoC exists — good. But I don't see code that prevents issuing a CoC when **required inspections are missing or failed**. Need a server-side check (edge function or DB trigger) that refuses CoC insert unless every required inspection has `result='pass'`.
   - No CoC PDF storage path verification — the CoC should be immutable like comment letters (sha256 + chained hash).

4. **Multi-tenant firm scoping**
   - All reads use RLS via `user_firm_id`. Verified. But `set_firm_id_from_user` trigger only fires when `firm_id IS NULL` on insert. If a malicious/buggy client passes another firm's UUID, the trigger doesn't override it. Should `RAISE` on mismatch, or unconditionally set `firm_id := user_firm_id(auth.uid())`.

### Medium risk (will surface in real use)

5. **Deadline alerts cron isn't scheduled**
   - `check_deadline_alerts()` exists but I don't see a `pg_cron` job that runs it. Without a schedule, no one gets the 7/3/1-day warnings or auto-hold on expiry. Need to add a cron (e.g., every 30 min).

6. **Inspection clock starts on schedule, not on request**
   - `set_inspection_clock_on_schedule` starts the 10-day clock when an inspection row is inserted. But statute counts from when the **applicant requests** the inspection, which can be before scheduling. Add an `inspection_requested_at` column distinct from `scheduled_at` and start the clock on request.

7. **Resubmission round detection is implicit**
   - `reset_review_clock_on_resubmission` resets the clock on every new plan_review insert. If a user accidentally creates a second project for the same job, the clock resets. Need a confirmation step + UI distinction between "new project" vs "resubmittal of existing".

8. **AI-extracted project info has no human verification gate**
   - `extract_project_info` populates fields, but there's no required "reviewer confirmed" checkbox before the project enters `plan_review`. For statutory work we should not start the clock on AI-only data.

### Low risk (polish, but visible)

9. **No "Deleted" view / restore UI** (mentioned above).
10. **No audit export** — for a real private-provider firm, you need a one-click export of the full project chain (notice → uploads → AI run → letters → resubmittals → inspections → CoC) as a single signed PDF/zip. Right now this is reconstructable from `activity_log` but not exportable.
11. **No backup/restore guarantee documented to user** — letters and CoCs are legally binding; the user needs to know what's archived where (storage paths, retention).
12. **Login error from logs**: `dan@projgrowth.com` had one failed login at 14:18 UTC followed by success — not a bug, just noting auth is working. No HIBP password check is enabled; recommend enabling for compliance.

## 3. Proposed order of operations

I'd tackle this in three waves once you approve:

**Wave A — Data hygiene & visibility (small, immediate)**
- One-time cleanup of the ~17 stale pre-Apr-28 test projects (you confirm the list first).
- Add "Show deleted" toggle + restore button on Projects page.

**Wave B — Statutory correctness (the legally-sensitive stuff)**
- Manual pause/resume action with reason → adjusts deadline.
- Schedule `check_deadline_alerts()` via pg_cron every 30 min.
- Block CoC issuance until all required inspections pass.
- Harden `firm_id` trigger to overwrite, not just default.
- Add `inspection_requested_at` and start clock on request.

**Wave C — Audit & UX polish**
- Round-chain viewer with hash verification on PlanReviewDetail.
- One-click full-project audit export (signed zip).
- "Reviewer confirmed extraction" gate before clock starts.
- Enable HIBP password check.

Approving this plan switches me to build mode for **Wave A only**. I'll come back for confirmation before Waves B and C since they touch statutory math and legal records.

