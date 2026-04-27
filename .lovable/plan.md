# Plan-review readiness audit & cleanup plan

I audited the full pipeline-to-letter path against the live data on the project you're viewing right now (Suncoast Porsche). On paper the pipeline shows nine green stages — in reality the review is **not shippable**:

- 40 findings, **all** Architectural (no Structural / MEP / Energy / LS — sheet_map only labeled cover sheets)
- **0 of 40** findings have a verified citation (everything is `not_found`, `mismatch`, or `hallucinated`)
- **0 of 40** findings have an `evidence_crop_url` (the crop stage runs but fails silently)
- **40 of 40** flagged `requires_human_review` (so the "needs eyes" chip is meaningless)
- `review_coverage` shows `sheets_reviewed: 0` of 74 — coverage telemetry is not wired
- No PE seal / license, no delivery channel, no immutable audit trail of "who signed what"

A reviewer cannot put their license behind this letter. The remaining work falls into 6 tracks.

---

## Track 1 — Make findings trustworthy (citation grounding + coverage)

The single biggest blocker. Today every finding ships with an unverified citation, which forces the export gate to demand the reviewer check 40 sections by hand — undoing the value of the AI.

**Root causes**
1. `fbc_code_sections` table has very few rows (the dashboard already shows "FBC citation database not seeded" when count = 0). The parent-section fallback added last loop helps, but the library is too sparse for it to land.
2. `ground_citations` returns `not_found` even when the section number is real — we don't normalize Florida-style code prefixes consistently (`FBC-B 1004.1.2`, `FBC 1004.1.2`, `R317.1`, `IBC 1004.1.2`).
3. `sheet_map` mis-labels every non-titled sheet as Architectural, so all findings get routed to one expert.

**What I'll build**
- **Seed the FBC reference library** with the canonical chapter list for FBC 8th Ed. (Building, Residential, Existing, Energy, Mechanical, Plumbing, Fuel Gas, Accessibility, Test Protocols). Ship a `supabase/seed/fbc_code_sections_chapters.sql` migration with ~600 chapter+section rows so parent-fallback always lands.
- **Citation normalizer v2** in `ground_citations`: strip `FBC-?[BRPMFGE]?\s+`, normalize `R\d+`, accept `IBC` as alias for `FBC-B`, lowercase, collapse whitespace. Unit-test against the 40 live findings on `aa5638ef-…`.
- **Sheet-map fallback by sheet code prefix**: when AI returns "General/Other" or empty, infer discipline from sheet number (`A-`/`AD` → Architectural, `S-` → Structural, `M-`/`E-`/`P-`/`FP-` → MEP/Life Safety, `C-`/`L-` → Civil/Landscape, `T-`/`G-` → Code/Title). This is what the experienced reviewer does in their head.
- **Wire `review_coverage.sheets_reviewed`**: `discipline_review` already iterates sheets — add an upsert at the end of each discipline pass so the coverage chip stops showing 0/74.
- **Tighten `requires_human_review`**: only true when (a) `citation_status = mismatch|hallucinated`, OR (b) `confidence_score < 0.5`, OR (c) AI itself set the flag with a reason. `not_found` against a sparse library is no longer enough.

## Track 2 — Evidence crops actually ship

The pipeline calls `attachEvidenceCrops` but every row still has `evidence_crop_url = null`. The current implementation maps `sheet_refs` → `plan_review_page_assets.cached_signed_url`, but those URLs expire and the lookup is by `page_index` not by sheet code, so misses are silent.

**What I'll fix**
- Resolve sheet_ref → page_asset via `sheet_coverage.page_index` (the canonical mapping written in `sheet_map`), not by parsing the storage path.
- Re-sign the page URL inside `attachEvidenceCrops` with a **30-day expiry** (matches statutory window) and store it directly. Today's "use whatever cached URL exists" path is what's failing.
- Add a `crop_failures` counter to `review_pipeline_status.dedupe.metadata` so we can see in one query why crops aren't landing.
- Render the crop in `FindingCard` (the JSX is already there, so this is purely a data fix) and in the exported letter (already wired in `CommentLetterExport` line 313).

## Track 3 — QC sign-off becomes a real gate, not a checkbox

Today `qc_status = 'qc_approved'` only requires a click from anyone except the original reviewer. There is no record of *what was reviewed*, *what citations were verified by hand*, or *what the PE accepted responsibility for*. The State expects all three.

**What I'll add (DB migration + UI)**
- New columns on `plan_reviews`:
  - `qc_approved_at timestamptz`
  - `qc_signature_text text` (typed name + license #, captured at sign-off)
  - `qc_findings_snapshot jsonb` (frozen copy of the findings + their statuses at the moment of approval — this is what the PE is signing)
  - `qc_unverified_acknowledged int` (count of `not_found`/`mismatch` citations the PE explicitly accepted)
- New table `review_signoffs` (immutable audit row per round): `plan_review_id`, `round`, `reviewer_id`, `qc_reviewer_id`, `signed_at`, `findings_count`, `findings_hash` (sha256 of the snapshot), `letter_hash`. Insert-only RLS; no updates, no deletes.
- New "QC Sign-off" dialog in `LetterPanel` replacing the bare Approve button: shows snapshot summary, lists unverified citations the reviewer must initial, requires typed name+license, then writes the snapshot + audit row in one transaction.
- `firm_settings`: add `pe_license_state`, `pe_license_number`, `pe_seal_url` (storage path) so the letter can render the seal in the signature block.

## Track 4 — Real delivery to the applicant

"Send to Contractor" today does nothing — it opens the linter dialog and shows a toast. There's no email, no portal share, no audit of when comments were delivered (which the statute clock depends on).

**What I'll build**
- New edge function `deliver-comment-letter` that:
  - Re-renders the letter HTML server-side from the QC snapshot (so a post-approval edit can't change what was sent)
  - Stores a frozen PDF (via the existing print-to-storage path) under `documents/projects/{projectId}/sent/round-{n}-{timestamp}.pdf`
  - Sends via Resend (add `RESEND_API_KEY` secret; ask the user to add it before this step) to the contractor email on file with the firm's letterhead address as the from
  - Inserts into a new `comment_letter_deliveries` table: `plan_review_id`, `round`, `delivered_at`, `delivered_to_email`, `pdf_storage_path`, `pdf_hash`, `delivered_by`
  - Logs `event_type = 'comment_letter_delivered'` to `activity_log` (this is also the event that pauses the statutory clock — currently `auto_manage_statutory_clock` only fires on a manual `comments_sent` status change)
- Update `LetterPanel` to show "Delivered {relative-time} to {email}" once `comment_letter_deliveries` has a row, and disable the Send button.
- Update `auto_manage_statutory_clock` trigger to also fire on the new `delivered_at` timestamp so the F.S. 553.791 clock pauses automatically.

## Track 5 — Workspace UX polish (the things reviewers complain about)

These are smaller but high-frequency annoyances I caught in `PlanReviewDetail.tsx`, `FindingsListPanel`, and `FindingCard`:

- **The sticky stack is too tall.** TopBar + UploadProgress + (optional) prepareErrored banner + StuckRecovery + SubmittalIncomplete + ReviewProvenanceStrip + RoundCarryover = up to 7 stacked rows above the document. Consolidate into a single **`ReviewBanners`** stack component that renders at most 2 banners at a time (most-severe first) and demotes the rest into a "1 more" expandable.
- **Two competing review surfaces.** `/plan-review/:id` (workspace) and `/plan-review/:id/dashboard` (triage) both render findings, with overlapping but inconsistent flag/disposition models (`reviewer_disposition` vs. `findingStatuses`). Pick one source of truth: keep the dashboard for triage, and make the workspace's right panel a **read-only** mirror that links to the dashboard for any disposition change. This kills a whole class of "I confirmed it on the workspace and it's still in the inbox" bugs.
- **Pin-repositioning is dead but still surfaced.** `handleRepositionConfirm` toasts an error every time. Remove the Move/Place-pin buttons in `FindingCard` and the `repositioningIndex` plumbing — pure tech debt that confuses users.
- **Active-finding scroll/highlight is one-way.** Clicking a pin scrolls the list but the reverse (clicking a finding) doesn't pan the document to the sheet. Wire `onLocate` → `usePdfPageRender.goToPage(sheet_index)` and update the URL `?page=` param so reviewers can bookmark.
- **Bulk actions are gated behind the dashboard.** Add a "Mark all matching pattern as resolved" in the workspace findings list when ≥3 findings share the same parent code section + sheet.
- **Letter editor has no diff view.** When the AI regenerates after the reviewer made edits, the edits are lost (the confirm dialog warns but doesn't preserve). Save the prior draft to `plan_reviews.previous_letter_drafts jsonb[]` and add an "Undo regenerate" toast action.

## Track 6 — Sanity checks visible to the reviewer

Right now there's no lightweight way for the reviewer to convince themselves "the AI looked at the right things." Add a single new tab on the Audit & Coverage panel:

- **Discipline coverage matrix** — a table of (discipline × sheets present × sheets reviewed × findings raised). Today's `review_coverage` row already has the data; we just don't render it.
- **"What I skipped" panel** — sheets that exist in `sheet_coverage` but have 0 findings AND were not flagged by `submittal_check`, with a one-click "Force-review this sheet" button that re-runs `discipline_review` for that single sheet.
- **Pattern hits** — show the top 5 `correction_patterns` that fired against this run (already stored in `applied_corrections`), so the reviewer sees their prior corrections shaped this output.

---

## Order of execution

1. **Track 1** (citation library + sheet-map fallback + coverage write) — unlocks everything else; without grounded citations the QC gate is theatre.
2. **Track 2** (evidence crops) — needed before Track 3, because the QC snapshot should embed the crop URLs.
3. **Track 3** (QC sign-off + PE seal + audit table).
4. **Track 4** (delivery edge function + statutory clock wiring) — requires `RESEND_API_KEY` from you.
5. **Track 5** (UX polish) — can run in parallel with 3/4 since they're isolated UI files.
6. **Track 6** (coverage matrix + skipped-sheet panel).

## Files to be created or modified

- `supabase/migrations/*` — `fbc_code_sections` chapter seed; `plan_reviews` qc_* columns; `review_signoffs` table; `comment_letter_deliveries` table; `firm_settings` PE columns; `auto_manage_statutory_clock` trigger update
- `supabase/functions/run-review-pipeline/index.ts` — `normalizeCitationSection` v2; `stageSheetMap` discipline fallback; `attachEvidenceCrops` page-asset lookup fix; coverage upsert in `stageDisciplineReview`; tighten `requires_human_review` rule
- `supabase/functions/deliver-comment-letter/index.ts` (new) — Resend + PDF freeze
- `src/components/plan-review/ReviewBanners.tsx` (new) — single banner stack
- `src/components/plan-review/QcSignoffDialog.tsx` (new) — typed name + license + unverified-acknowledge
- `src/components/plan-review/DeliveryStatusRow.tsx` (new)
- `src/components/plan-review/LetterPanel.tsx` — wire delivery + signoff dialog
- `src/components/plan-review/PlanViewerPanel.tsx` — sheet-pan on locate
- `src/components/FindingCard.tsx` — drop dead reposition UI; wire delivered evidence_crop_url
- `src/components/CommentLetterExport.tsx` — render PE seal; freeze HTML for delivery
- `src/components/review-dashboard/AuditCoveragePanel.tsx` — coverage matrix + skipped-sheets + pattern hits
- `src/hooks/useReviewHealth.ts` — count `delivered` & `signed` states
- `src/pages/PlanReviewDetail.tsx` — replace banner stack with `ReviewBanners`; remove repositioning state

## What I need from you before starting Track 4

- A `RESEND_API_KEY` (or your preferred transactional email provider) — I'll request it via the secrets tool when I get there.
- Confirmation that you want the PE seal as an upload field on each user's profile (recommended) vs. one-per-firm.

Approve and I'll start with Track 1.