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

### Out of scope (saved for Sprint 3)

- PDF hashing / immutable chain-of-custody for snapshots (P2).
- `lineage_id` on `deficiencies_v2` for cross-round defect tracking (P2).
- Multi-pause statutory clock history UI (the column was added in Sprint 1; UI ships in Sprint 3).

### Acceptance

- A 4-story office submittal triggers `is_threshold_building=true`, generates a high-severity Structural finding referencing F.S. 553.79(5), and `LetterReadinessGate` blocks letter generation until Special Inspector is recorded.
- A Life Safety finding for a corridor dead-end shows dual citation `FBC-B 1020.4 / NFPA 101 7.5.1.5` after grounding.
- An Accessibility finding leads with `FBC 11-206.2.3 / FAC 61G20` and only mentions 2010 ADA parenthetically.
- A resubmission window starting on the Tuesday before Thanksgiving lands on the correct post-holiday business day, not 14 raw calendar days.