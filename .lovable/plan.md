## Sprint 2 — P1: Code coverage gaps + threshold automation ✅ shipped (auto-finding deferred to Sprint 3)

Sprint 1 closed the statutory filing/license gates. Sprint 2 closes the **code authority** gaps a Florida private provider can be cited for: incomplete fire code coverage (NFPA 1 / NFPA 101 / FFPC), missing threshold-building detection (F.S. 553.79(5)), and reviewer guidance that still treats accessibility as ADA-first instead of FBC Ch. 11 + FAC 61G20-first.

### What goes in this sprint

**1. Fire code coverage — add NFPA 1, NFPA 101, FFPC to the canonical library**

Today the canonical sections table (`fbc_code_sections`) only carries FBC families. Florida adopts NFPA 1 (Fire Code) and NFPA 101 (Life Safety Code) by reference through the Florida Fire Prevention Code (FFPC, 7th Ed., F.A.C. 69A-60). A Life Safety finding that cites only FBC-B Ch. 10 will get rejected by AHJ fire reviewers.

- Migration: extend the `code` enum / check on `fbc_code_sections` to accept `NFPA1`, `NFPA101`, `FFPC`. Add a `code_family` column (`building` | `fire` | `accessibility` | `energy` | `mechanical` | `plumbing` | `electrical`) so the grounder can prioritize the right family per discipline.
- Seed ~80 of the most-cited NFPA 101 / NFPA 1 sections (egress capacity, common path, dead-ends, occupant load by occupancy, fire alarm thresholds, sprinkler thresholds, hazardous-area protection). These are the sections AHJ fire reviewers cite back at private providers most often.
- Update `stages/ground-citations.ts` so when a finding's discipline is `LifeSafety` or `FireProtection`, the matcher considers fire-family canonicals first, falls back to FBC.
- Update Life Safety + Fire Protection expert prompts in `discipline-experts.ts` to require **dual-citation** when applicable (e.g., "FBC-B 1006.2.1 / NFPA 101 7.6") and explicitly say "If FFPC is more stringent, FFPC controls."

**2. Accessibility expert — promote FBC Ch. 11 + FAC 61G20 over 2010 ADA**

The current Accessibility persona already mentions FAC, but its `checkDomains` and example citations still default to ADA section numbering. Florida private providers must cite **FBC Chapter 11** (which adopts FAC) as the primary authority; ADA is federal civil-rights law, not the permit code.

- Reorder Accessibility `checkDomains` so every bullet leads with `FBC 11-` or `FAC 61G20-` and only references `2010 ADA` parenthetically.
- Add failure-mode: "Cited 2010 ADA section without the corresponding FBC 11/FAC reference — AHJ will reject as non-jurisdictional."
- Update wordingGuidance to mandate `FBC 11-X / FAC 61G20-X (cf. 2010 ADA Y)` format.

**3. Automated threshold-building detection**

F.S. 553.79(5) requires a Special Inspector designated by the Engineer of Record for "threshold buildings" (>3 stories OR >50 ft OR >5,000 sf assembly occupancy with >500 occupants). Today `thresholdBuildingAmount` exists per-county but nothing reads DNA to flag it.

- Extend `stages/dna.ts` to compute `is_threshold_building: boolean` + `threshold_triggers: string[]` from extracted DNA (stories, height_ft, occupancy_classification, total_sq_ft, occupant_load). Persist into `plan_reviews.dna_extracted` JSON (no schema change needed — it's already JSONB).
- Migration: add `plan_reviews.special_inspector_designated` (boolean) + `plan_reviews.special_inspector_name` (text) + `plan_reviews.special_inspector_license` (text). Mirrors the Sprint 1 statutory fields.
- Extend `letter-readiness.ts` with a new `threshold_special_inspector` check that **blocks** letter generation when `is_threshold_building === true` and special inspector fields are empty.
- Surface in `StatutoryCompliancePanel.tsx`: add a "Threshold Building" section that shows the triggers DNA detected and a small form to record the Special Inspector designation. If not a threshold building, render a single "Not a threshold building" green chip.
- Auto-create a high-severity finding via `stages/discipline-review.ts` Structural pass when threshold is detected but no Statement of Special Inspections is present in submittal.

**4. Florida holiday + AHJ resubmission window in the statutory clock**

`compute_statutory_deadline` already skips weekends, but F.S. 553.791 review days are calendar days for the AHJ but business days for many counties' resubmission windows. Today every county uses 14 calendar days regardless.

- Add `business_days_resubmission: boolean` to `CountyRequirements` (default true) and a Florida holiday list (New Year, MLK, Memorial, Juneteenth, July 4, Labor, Veterans, Thanksgiving + day after, Christmas Eve + Christmas) consumed by `statutory-deadlines.ts`.
- Update `statutory-deadlines.ts` to compute resubmission deadlines that skip Florida holidays; add a small "next business day after holiday" indicator on `StatutoryClockCard.tsx` when applicable.

### Files touched

**New / migrations**
- `supabase/migrations/<ts>_p1_fire_code_threshold.sql` — extend `fbc_code_sections.code`, add `code_family`, seed NFPA/FFPC rows; add `special_inspector_*` columns on `plan_reviews`.

**Edited**
- `supabase/functions/run-review-pipeline/stages/dna.ts` — threshold detection.
- `supabase/functions/run-review-pipeline/stages/ground-citations.ts` — family-aware matching.
- `supabase/functions/run-review-pipeline/stages/discipline-review.ts` — auto-finding for missing Special Inspections statement.
- `supabase/functions/run-review-pipeline/discipline-experts.ts` — Accessibility, LifeSafety, FireProtection prompt rewrites.
- `src/lib/letter-readiness.ts` — `threshold_special_inspector` blocking check.
- `src/lib/statutory-deadlines.ts` — Florida holidays + business-day resubmission.
- `src/lib/county-requirements/types.ts` + `data.ts` — `business_days_resubmission` flag.
- `src/components/plan-review/StatutoryCompliancePanel.tsx` — Threshold Building section + Special Inspector form.
- `src/components/StatutoryClockCard.tsx` — holiday-shifted indicator.

## Sprint 3 — P2: Chain-of-custody + cross-round tracking ✅ shipped

**Migration**: `pdf_sha256` + `file_size_bytes` on `plan_review_files`; `pdf_sha256` + `letter_html_sha256` on `comment_letter_snapshots`; `lineage_id` (uuid, default gen_random_uuid()) on `deficiencies_v2` with indexes.

**Hashing**: `src/lib/file-hash.ts` (Web Crypto SHA-256 helpers). `plan-review-upload.ts` fingerprints every PDF before bucket upload; `send-letter-snapshot.ts` hashes the letter HTML at send time.

**Cross-round lineage**: `dedupe.ts` runs `applyCrossRoundLineage()` for Round 2+ — matches each new finding to the prior-round finding on (same FBC section OR same discipline) + sheet overlap + Jaccard ≥ 0.55, then inherits the prior `lineage_id`. Logged via `activity_log` event_type `lineage_carryover`.

**Threshold auto-finding (conditional)**: `emitThresholdAutoFinding()` in `dedupe.ts` emits a high-severity Structural `DEF-S###` citing F.S. 553.79(5) when DNA classifies the project as threshold AND no Special Inspector has been recorded AND no existing finding already covers Special Inspections.

**Statutory clock history UI**: `StatutoryClockCard.tsx` now fetches `activity_log` events of type `statutory_clock_*` / `deadline_overdue` for the project and renders a collapsible audit trail. Removed the prior `animate-pulse` urgency styling per project memory rule.

### Acceptance
- An uploaded PDF round-trips with its SHA-256 stored on `plan_review_files`.
- A sent letter writes `letter_html_sha256` for tamper detection.
- A Round 2 finding matching a Round 1 defect inherits the same `lineage_id`.
- A 4-story office without a Statement of Special Inspections gets an auto-emitted `DEF-S###`; a reviewer recording the Special Inspector before re-running suppresses re-emission.
- The clock card shows pause/resume/reset history without animations.
