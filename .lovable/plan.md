# Tier 1: Close the Input-Layer Gap

The reasoning chain is solid. Every remaining accuracy loss traces back to one fact: **we feed Gemini a downsampled PNG and nothing else**. pdf.js is already loaded in the browser and we already call `getTextContent` for evidence cropping — we're throwing the result away after one use. This plan persists that text, parses it for callouts, tiles large sheets, and broadens submittal completeness.

Four changes, all additive. Nothing in the existing 7-stage pipeline gets removed.

---

## 1. Persist the PDF text layer per page

**Where:** Browser-side rasterizer in `src/lib/pdf-utils.ts` and the wizard upload path that calls it.

**What:** When we already render a page for rasterization, also extract `page.getTextContent()` items and write them to a new `plan_review_page_text` table:

```text
plan_review_page_text
  plan_review_id  uuid
  page_index      int
  sheet_ref       text     (joined from sheet_coverage)
  items           jsonb    [{ text, x, y, w, h, rotation, fontSize }]
  full_text       text     (concatenated, for embedding/search)
  has_text_layer  bool     (false = scanned, future OCR hook)
  PRIMARY KEY (plan_review_id, page_index)
```

RLS: same firm_id pattern as `plan_review_page_assets`.

**Why:** Right now every dimension, sheet number, room label, and code reference goes through Gemini's OCR. Persisting the vector text layer means:
- The discipline_review prompt receives `{image + extracted_text_for_this_sheet}` instead of just the image. Hallucinated sheet numbers and dimensions drop sharply.
- ground_citations gets exact code-section strings to match against `fbc_code_sections` (no more "I think it said R301.6").
- Evidence quotes become verifiable — we can confirm the AI's quote actually appears on the page before accepting the finding.

## 2. Parse callouts and build a cross-reference graph

**Where:** New deterministic stage `callout_graph` inserted in `CORE_STAGES` between `sheet_map` and `submittal_check`. Pure regex/text — zero AI cost.

**What:** Scan `plan_review_page_text.full_text` for the standard callout patterns:
- Detail bubbles: `\d+/[A-Z]+-?\d+(\.\d+)?` (e.g. `4/A5.2`, `12/S-301`)
- Section marks: `SECTION\s+[A-Z\d-]+`
- Sheet refs in notes: `SEE SHEET ([A-Z]-?\d+)`
- Schedule refs: `SCHEDULE [A-Z\d-]+`

Persist to a new `callout_references` table:

```text
callout_references
  plan_review_id   uuid
  source_page      int
  source_sheet_ref text
  raw_text         text       ("4/A5.2")
  target_sheet_ref text       ("A5.2")
  target_detail    text       ("4")
  resolved         bool       (does target_sheet_ref exist in sheet_coverage?)
  detail_found     bool       (does target page actually contain detail "4"?)
```

Emit one finding per `resolved=false` row as a `cross_sheet` discipline deficiency: *"Sheet A2.1 references detail 4/A5.2 but sheet A5.2 was not submitted."* These are the cheapest, most defensible findings we can produce and reviewers love them.

## 3. Tile large sheets for the discipline_review pass

**Where:** `signedSheetUrls` consumer in `discipline-review.ts` and the browser rasterizer in `pdf-utils.ts`.

**What:** When a page asset is rasterized at >4000px on its long edge, also render four overlapping crops (top-left/top-right/bottom-left/bottom-right at 60% overlap) and store them as `tile_index` 1–4 alongside the full-page asset (`tile_index = 0`).

For the discipline_review chunk loop, when a sheet has tiles, send the full page **plus** the 4 tiles in the same call. Token cost goes up ~3× per large sheet, but small-text findings (notes blocks, dimension stacks) stop being missed.

Gate behind a feature flag (`feature_flags.tile_large_sheets`) so we can A/B against current accuracy before forcing it on.

## 4. Expand submittal_check matrix per occupancy class

**Where:** `stages/submittal-check.ts`. The current check only looks for the trade buckets S/M/P/E/FP. Real Florida commercial submittals expect specific document categories.

**What:** Replace the flat `expected = [...]` list with a per-`use_type` matrix that also checks for documents (not just sheets):

```text
For commercial / business / mercantile (FBC Ch.3 Group B/M):
  required sheets:    A, S, M, P, E, FP, C, L
  required documents: structural calcs, energy compliance form,
                      product approval forms, soil report, fire alarm
                      narrative, accessibility checklist
  required schedules: door, window, finish, lighting, panel
```

Source the matrix from the existing `county_requirements/data.ts` seed where possible; fall back to a hard-coded FBC default. Each missing item raises one `permit_blocker` finding tagged `administrative` so reviewers see the gap before any AI runs.

---

## Files affected

**New / changed:**
- `src/lib/pdf-utils.ts` — emit `{items, full_text, has_text_layer}` from rasterizer
- `src/components/plan-review/wizard/...` (wherever `uploadPlanReviewFiles` lives) — write to new table after upload
- `supabase/functions/run-review-pipeline/stages/callout-graph.ts` — new stage
- `supabase/functions/run-review-pipeline/stages/discipline-review.ts` — accept `pageText` context, support tiles
- `supabase/functions/run-review-pipeline/stages/submittal-check.ts` — replace flat list with matrix
- `supabase/functions/run-review-pipeline/_shared/types.ts` — add `callout_graph` to CORE_STAGES
- `supabase/functions/run-review-pipeline/discipline-experts.ts` — prompt update to consume page text

**New tables (one migration):**
- `plan_review_page_text`
- `callout_references`

**No changes to:** verify, challenger, ground_citations, dedupe, prioritize, learning loop, UI.

## Rollout safety

- Each change is independent — ship in 4 separate runs if needed.
- Tile rendering is feature-flagged (`feature_flags.tile_large_sheets`).
- Callout graph stage is purely additive; if it errors it's added to `SERVER_RECOVERABLE_STAGES` and skipped.
- Text-layer table is read-optional — discipline_review falls back to image-only if the row is missing (handles legacy reviews uploaded before this change).

## What this should move

| Metric | Today | Target after Tier 1 |
|---|---|---|
| Unverified findings (post-verify) | ~40–60% | <20% |
| Hallucinated sheet/code refs | common | rare (text-layer grounding) |
| Cross-sheet findings caught | 0 | All broken refs |
| Submittal-incomplete catches | trade-level only | Doc + schedule level |
| Tokens per discipline call | baseline | -25% (less OCR work for the LLM, even with tiles) |

After Tier 1 lands cleanly, Tier 2 (vector geometry + symbol detection) becomes the next pass.
