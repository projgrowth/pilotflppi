## Plan Review — Precision & Reliability Plan

The pipeline runs end-to-end, but the data shows real gaps. Across 313 current findings:

- **Only 8 of 313 (2.5%) have a verified FBC citation.** 47 are not-found, 19 are hallucinated, 69 are mismatched, 170 were never grounded.
- **0 of 313 have an evidence crop.** Reviewers can't see what the AI saw.
- **Discipline labels are fragmented**: "Architectural" vs "architectural", "MEP" vs "mechanical/electrical/plumbing", "Life Safety" vs "life_safety". 21 distinct buckets where there should be ~10.
- **Verification is mostly skipped**: 234 of 313 are still `unverified`; only 25 verified, 24 overturned. The verifier isn't running on enough findings.
- **Cross-check produced 3 findings ever** — likely too restrictive.

This plan tightens each weak link without rewriting the pipeline.

---

### 1. Stop emitting findings with bad citations

**Problem:** 41% of grounded findings (135/322) have a broken citation (mismatch / not-found / hallucinated). They still ship to the comment letter.

**Fix:**
- In `discipline-review.ts`, add a citation-required rule to the system prompt: every finding must cite an FBC section that the model is confident exists. If unsure, use `requires_human_review=true` instead of guessing.
- After `ground_citations` runs, auto-flip any finding with `citation_status in ('not_found','hallucinated')` to `verification_status='needs_human'` and downgrade `priority` one notch. They still appear, but never auto-publish to a letter.
- Add a server-side guard in `letter-readiness.ts` (or its edge equivalent) blocking letter generation if any cited finding is `hallucinated`.

### 2. Make every finding show its evidence crop

**Problem:** 0 findings have `evidence_crop_url`. The viewer falls back to deterministic hash pins, which are only approximate.

**Fix:**
- Add a new sub-step at the end of `ground_citations` (or split into a new mini-stage `evidence-crop`) that, for each finding with a `sheet_refs[0]` and `page_index`, asks the AI vision model to return a normalized bounding box `{x,y,w,h}` for the cited element.
- Persist the box to `evidence_crop_meta` and render the actual cropped PNG to storage; populate `evidence_crop_url`.
- `PlanMarkupViewer` already supports markup coords — switch from the deterministic hash to the real crop when present.
- Cap to 1 vision call per 4 findings via batching (group by sheet to amortize the page image).

### 3. Canonicalize disciplines once, at write time

**Problem:** Adapter normalization happens at read time, but the DB stores raw labels, so analytics, dedupe bucketing, and learning patterns all see fragmented strings.

**Fix:**
- Run `normalizeDiscipline` (already in `county-utils.ts`, port to `_shared/types.ts`) inside `discipline-review.ts` and `cross-check.ts` BEFORE the insert. Store the canonical lowercase slug.
- Backfill migration: `UPDATE deficiencies_v2 SET discipline = lower(...)` mapping the existing 21 buckets to ~10 canonical ones.
- Drop the read-side normalization so the rest of the system sees one source of truth.

### 4. Make the verifier actually run on everything that matters

**Problem:** 234 findings sit in `verification_status='unverified'`. The verify stage filters by `confidence_score < threshold OR priority = high`, but in practice few qualify.

**Fix:**
- Lower the verifier trigger: ALL findings get verified except those with `confidence_score >= 0.9 AND priority='low'`.
- Batch by sheet (verifier currently re-sends sheet images per finding) — pack 5–8 findings per call.
- Add a hard rule in the verify prompt: if `cannot_locate`, route to human review (already there) — but also auto-set `requires_human_review=true` so it surfaces in the triage inbox.

### 5. Tune cross-check from "near-zero recall" to "useful"

**Problem:** Only 3 cross-sheet findings across all reviews. The "must quote both sides verbatim" gate is too strict.

**Fix:**
- Allow `confidence_score >= 0.7` instead of requiring verbatim quotes from both sheets — but require the verifier to confirm before it can publish.
- Expand the category enum with `accessibility_clearance_vs_plan` and `roof_uplift_vs_truss_layout` (common Florida gaps).
- Always run cross-check on at least one Architectural × Structural pairing if both disciplines have findings.

### 6. Stop the dedupe stage from collapsing legitimate distinct findings

**Problem (audit):** Dedupe buckets by `fbc_section + sheet_ref` then merges by 0.55 token Jaccard. This silently kills two real issues that cite the same code section on the same sheet (e.g. two separate stair handrails both citing 1014.8).

**Fix:**
- Raise Jaccard threshold to 0.75.
- Require a SECOND signal (overlapping `evidence` text or matching bounding box) before merging.
- Log every merge to `activity_log` with the surviving + suppressed `def_number`s so dedupe can be audited and undone.

### 7. Add a "review confidence" score per project

**Problem:** Reviewers can't tell at-a-glance whether the AI run was high-quality or shaky.

**Fix:**
- Compute a single 0–100 score on `complete` stage and store in `plan_reviews.ai_run_progress.quality_score`:
  - +30 if ≥80% of findings have `citation_status='verified'`
  - +30 if ≥80% have `verification_status in ('verified','modified')`
  - +20 if ≥80% have evidence crops
  - +20 if no `hallucinated` citations
- Surface as a chip on the review header. Below 60 → banner: "Low-confidence run, recommend human spot-check."

---

### Technical changes (concise file list)

**Edge functions:**
- `stages/discipline-review.ts` — citation-required prompt rule, normalize discipline at write
- `stages/verify.ts` — broaden trigger, batch by sheet
- `stages/ground-citations.ts` — auto-flip hallucinated/not_found to `needs_human`; chain into evidence crop
- `stages/cross-check.ts` — relax verbatim rule, expand categories
- `stages/dedupe.ts` — stricter merge gate, audit log
- `stages/complete.ts` — compute quality_score
- New: `stages/evidence-crop.ts` (or fold into ground-citations) — vision-extract bounding boxes

**Frontend:**
- `PlanMarkupViewer.tsx` — prefer real `evidence_crop_meta` box over deterministic hash
- `ReviewSummaryHeader.tsx` — show quality_score chip
- `letter-readiness.ts` — block letter on any `hallucinated` citation

**Database (migrations):**
- Backfill: canonicalize `deficiencies_v2.discipline` values
- Index: `(plan_review_id, citation_status)` for the new auto-flip query
- Add column: `plan_reviews.ai_run_quality_score numeric` (or store in `ai_run_progress` JSON)

### Out of scope for this pass
- New AI model selection (current Gemini 2.5 Pro is fine)
- UI redesign of the findings panel
- Replacing the deterministic hash pin (keep as fallback when no crop exists)

Approve and I'll implement in order: 3 (canonicalize) → 1 (citation guard) → 4 (verifier) → 6 (dedupe) → 2 (evidence crops) → 5 (cross-check) → 7 (quality score).