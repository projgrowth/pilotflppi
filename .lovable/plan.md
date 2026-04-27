## What's actually broken (evidence from your current Suncoast Porsche review)

I pulled the live data for the review you're looking at right now (`aa5638ef…`). Here's what 40 findings look like in production:

| Metric | Suncoast Porsche | What it should be |
|---|---|---|
| Total findings | 40 | ✓ |
| Citations grounded | **0** | 35+ |
| Citations marked "mismatch" | 7 | 0–2 |
| Findings flagged "needs human review" | **38 of 40** | <10 |
| Findings with an evidence crop image | **0** | 30+ |
| First 12 findings, root cause | All variants of "code summary / construction type missing on cover sheet" | Should be 1 finding |

Three real bugs are causing this. None are cosmetic.

---

### Bug 1 · The citation grounder is matching the wrong field format

The AI emits `code_reference.section = "FBC-B 508"`. The `fbc_code_sections` library stores the same section as `"508"`. The grounder does a literal compare, so **every citation comes back `not_found`** and we mark them unverified. The seed library has 151 valid sections — none of them carry the `FBC-B ` prefix.

**Fix:** normalize both sides in `groundCitations` — strip leading `FBC-B `, `FBC-` and trim — before comparing. While we're there, also fall back to a "starts-with" match on the section prefix (`508.4` should match a stored `508`) and store the matched canonical section back on the row so the UI can show the verified citation, not the AI's guess.

This single fix should flip ~80% of the "not_found" citations to "verified" with no other changes.

### Bug 2 · Dedupe is letter-matching findings, not concept-matching

The first 12 architectural findings on this review are all variants of "construction type / code summary / FBC edition missing from cover sheet G001." Each one cites a different sub-section, so the current dedupe (which keys on `discipline + sheet + def_number`) keeps them as 12 separate findings. A reviewer reading the letter sees 12 redundant comments.

**Fix:** add a second dedupe pass keyed on `(discipline, sheet, normalized_finding_topic)` where `normalized_finding_topic` is the AI-extracted topic. Cheapest implementation: in the `dedupe` stage, when two findings on the same sheet share the same first 6 normalized words of the finding text **or** their cited section's parent (e.g. both 508.x), collapse them into one with the worst-case priority and a merged `code_reference[]` array.

We already have a `dedupe` stage in the pipeline — this is just tightening its similarity rule, not adding a new stage.

### Bug 3 · Evidence crops never get generated

`evidence_crop_url` is null on every finding. The schema is built for it (`evidence_crop_url`, `evidence_crop_meta`), the pin-placement logic depends on it, but nothing in the pipeline actually writes one. Reviewers have to mentally jump from "DEF-A012, sheet A-201" to the PDF and search.

**Fix:** add a lightweight `crop_evidence` step at the tail of `discipline_review` (or piggyback on `ground_citations`): for each finding with `sheet_refs[0]`, fetch the corresponding `plan_review_page_assets.vision_storage_path`, crop a 1024×768 region centered on the AI-returned bbox (or full sheet if no bbox), upload to the `documents` bucket as `crops/{review_id}/{finding_id}.png`, and store the path. The `FindingCard` already has a slot to render it.

If a tight bbox isn't returned, fall back to the full sheet thumbnail — that's still infinitely better than a text reference.

---

## What we'll ship (one loop, in order)

### 1. Citation grounder normalization (highest leverage — fixes 80% of "needs review")

Edit `groundCitations` stage in `supabase/functions/run-review-pipeline/index.ts`:

- Add `normalizeSection(s)` helper: strip `FBC-B `, `FBC-`, `FBC `, lowercase, trim.
- Compare normalized AI section ↔ normalized stored section.
- If exact match fails, try parent-section match (`508.4.1` → `508.4` → `508`).
- On match: set `citation_status='verified'`, `citation_canonical_text` = stored requirement, `citation_match_score=1.0`, `citation_grounded_at=now()`.
- On no match anywhere: keep `not_found` but **don't** set `requires_human_review=true` solely for that reason. Reviewer-needed should be reserved for low-confidence findings, not unverifiable citations.

### 2. Concept-level dedupe

Edit the `dedupe` stage:
- Group findings by `(discipline, primary_sheet)`.
- Within a group, run a cheap similarity check on the first sentence of `finding`: shingled token overlap > 0.6 → merge.
- Also merge any two findings whose `code_reference.section` shares the same parent (e.g. `508.4` and `508.4.1`).
- Merged finding keeps the worst-case `priority`, union of `code_reference[]`, union of `evidence[]`, and a counter `merged_from: 4` so the UI can show "merged from 4 similar findings."

### 3. Evidence crops

Add a `crop_evidence` sub-step inside `discipline_review` (cheaper) or as a tail step in `ground_citations`:
- For each finding with `sheet_refs.length > 0`:
  - Resolve the page asset via `plan_review_page_assets`.
  - If the AI returned an `evidence_crop_meta.bbox`, crop to it + 10% padding.
  - Otherwise upload the full page as the crop (acceptable fallback).
  - Write to `documents/crops/{plan_review_id}/{finding_id}.png`, signed URL into `evidence_crop_url`.
- No new table, no schema migration.

### 4. UI polish (small, but visible)

- **`FindingCard`**: distinguish `not_found` (grey "code lookup unavailable") from `mismatch` (red "citation conflict") — they currently both look like errors. Show `merged_from` badge when present.
- **`ReviewProvenanceStrip`**: change "verified" copy to use new grounding numbers; surface "X findings merged in dedupe" so reviewers trust the lower count.
- **`FindingsListPanel`**: keep the existing default sort, but add a permanent "Top 5 root causes" collapsible at the top of the list — groups merged findings by topic so reviewers see "Cover sheet code summary (8 instances)" before scrolling.

---

## Files to change

- `supabase/functions/run-review-pipeline/index.ts` — `groundCitations`, `dedupe`, new `cropEvidence` helper.
- `src/components/FindingCard.tsx` — citation status copy, `merged_from` badge, evidence crop image rendering.
- `src/components/plan-review/ReviewProvenanceStrip.tsx` — updated grounding/dedupe copy.
- `src/components/plan-review/FindingsListPanel.tsx` — top-of-list "root causes" collapsible.

No DB migrations. No new tables. No new secrets.

---

## What we're explicitly **not** doing

- Re-running the 40-finding review automatically. After this ships, you can hit "Run AI check" on Suncoast Porsche and the same 40-finding output should collapse to ~12–15 grounded, mostly-non-flagged findings.
- Backfilling evidence crops on old reviews. New runs only.
- Touching the `verify` / `cross_check` deep stages — those work, they're just optional.

Approve and I'll ship it.