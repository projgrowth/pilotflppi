
# Beta-Readiness Gaps — What's Still Missing

The core engine (pipeline, citation grounding, readiness gates, learning loop, snapshots, archive export) is solid. The remaining gaps are the things that make a first-time beta reviewer **bounce, get stuck, or lose confidence** — not engine quality.

Here's what to add, grouped by impact.

---

## Tier 1 — Blockers for a credible beta (must-have)

### 1. First-run onboarding & empty-state guidance
A new firm logs in to a blank `/projects` and has no idea what to do first. We need:
- A 4-step "Get Started" checklist on `Dashboard`: (1) complete firm settings (name + license + E&O), (2) add reviewer license disciplines to profile, (3) create first project, (4) upload first plan set. Persist completion in `firm_settings` (new jsonb `onboarding_state`).
- Friendly empty states on `Projects`, `Inspections`, `Invoices`, `Contractors`, `Deficiencies` — current ones are mostly bare tables.
- A "Sample project" seed button in dev/beta that loads a tiny PDF + pre-canned findings so reviewers can see the full UX without uploading first.

### 2. Pipeline cancel / rescue is undiscoverable
`StuckRecoveryBanner` and `cancelPipelineForReview` exist but nothing tells the user *when* a run is genuinely stuck vs slow. Add:
- A "Last activity Xm ago" indicator on the `PipelineProgressStepper`, surfacing in red after >5 min of no stage advancement.
- Surface `pipeline_error_log` retries inline as the run proceeds (not just after) so users see "Critic stage retried 1× — continuing".
- A clearly-labeled "Cancel run" button on the progress UI (currently only via banner), with confirmation.

### 3. Global runtime safety net
Wrap routed pages in route-level `ErrorBoundary` instances (we have one component, but it's only at the App root). A crash in `PlanReviewDetail` currently nukes the whole shell. Use the existing `ErrorBoundary` to scope each `<Route>` so users can bail out to `/projects` without a full reload.

### 4. Auth/session UX
- Show a session-expired toast + auto-redirect to `/login` when any query returns 401, instead of silent failure.
- Detect `navigator.onLine === false` and show a single banner "You're offline — changes will not save". Currently nothing tells the reviewer their disposition save vanished.

### 5. Reviewer license capture in profile
`letter-readiness` blocks send when reviewer licenses don't match disciplines, but there is **no UI to add licenses to your profile**. We need a "Professional Licenses" section in `Settings` → My Profile (PE/RA disciplines + license number + jurisdiction + expiration). Without this, every beta tester hits a hard block on their first letter.

### 6. AHJ recipient address book
`RecordDeliveryDialog` and CoC `ahj_recipient` are free-text. Add a simple per-firm `ahj_recipients` table (jurisdiction, name, email, address) populated from prior sends — autocomplete on the dialogs. Beta testers will retype the same building department 50 times otherwise.

---

## Tier 2 — High-leverage polish

### 7. "What does this mean?" explainers
The dashboard surfaces lots of jargon (citation_status, verification_status, challenger, dedupe_audit, sheet coverage, threshold building). Add a `(?)` popover next to each chip linking to a short plain-English explanation. One reusable `<MetricExplainer term="…" />` component sourced from a `src/lib/glossary.ts` file.

### 8. Keyboard shortcut cheat sheet
`TriageShortcutsOverlay` exists but isn't auto-shown. Trigger on first visit per user (localStorage) + bind `?` globally to re-open. Add shortcuts list to the `BetaFeedbackButton` menu.

### 9. Letter preview in actual delivery format
`LetterPanel` shows the editor but reviewers want to see what the AHJ receives. Add a "Preview as PDF" tab that renders the same HTML→PDF pipeline used for snapshots, before mark-sent. Currently they only see the rendered output post-send in `LetterSnapshotViewer`.

### 10. Bulk operations on findings
`BulkActionBar` exists for confirm/reject but cannot bulk: assign discipline tag, change priority, or move between rounds. Reviewers triaging 80+ findings will ask for these by day 2.

### 11. Notification preferences
Pipeline runs in the background — give the user the option to receive a browser notification (or email via existing edge function) when a long-running review completes. Currently they must keep the tab open or come back and guess.

### 12. Audit-ready export per finding
Beyond the project archive zip, add a per-finding "Export evidence packet" (PDF: finding text, citation, code excerpt, sheet crop, lineage). AHJs increasingly request this for contested items.

---

## Tier 3 — Nice-to-have for beta confidence

- **Fee schedule defaults**: pre-populate FL counties from `jurisdictions_fl` so invoicing isn't blank on day 1.
- **Project DNA "edit" UI**: today users can confirm or re-run; they can't manually correct extracted fields. Add inline edit on `DNAConfirmCard`.
- **Comment letter templates**: allow the firm to save 2–3 letter intros/closings as named templates rather than only `closing_language` in `firm_settings`.
- **Test-mode flag on firms**: tag beta firms so we can filter their data out of analytics rollups and so the AI cost meter labels their runs.

---

## Out of scope (intentionally)

- Multi-state code support — Florida-only is fine for beta.
- Mobile-first inspector app — desktop reviewer flow is the beta target.
- Public AHJ portal — already deferred.

---

## Suggested execution order

If approved, I'd ship in this order to maximize beta value per phase:

| Phase | Items | Why first |
|-------|-------|-----------|
| **A** | 5 (licenses), 4 (auth/offline), 3 (route error boundaries) | Unblocks first letter send + prevents data loss |
| **B** | 1 (onboarding), 7 (explainers), 2 (cancel/rescue UX) | Removes "what now?" confusion |
| **C** | 6 (AHJ book), 9 (letter PDF preview), 10 (bulk ops) | Reduces per-review friction |
| **D** | 8, 11, 12 + Tier 3 | Polish |

Approve the whole thing, or tell me which phases / items to drop and I'll implement.
