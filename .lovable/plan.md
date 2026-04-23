

# Lift the 10-page cap & tighten the plan-review pipeline

## What's actually happening on the Porsche review

```text
plan_review 85919248-… (SUNCOAST PORSCHE)
  page assets ready   : 78    ← all pages rasterized in browser ✅
  sheets mapped       : 78    (74 Architectural + 4 General)
  disciplines fed AI  : 10    ← capped by MAX_DISCIPLINE_PAGES = 10
  deficiencies found  : 4     ← 64 Architectural sheets never reviewed
```

There are **two independent 10-page caps**, both of which feel like "it can only review 10":

1. **Server-side, real**: `stageDisciplineReview` slices each discipline's image list to `MAX_DISCIPLINE_PAGES = 10` (line 1191). For a 74-sheet Architectural set this is the actual ceiling on AI coverage. The "Limited review" banner you see on the workspace is honest about #2 below, but it doesn't even know about this server-side cap.
2. **Client-side, cosmetic**: `usePdfPageRender` caps the in-browser **viewer** at 10 pages (`renderPDFPagesToImages(file, 10, …)`). This is display-only — it doesn't change what the AI processed — but it makes the workspace show a "Limited review — first 10 of 78" banner regardless of how many pages the AI actually saw.

Neither cap is necessary anymore. The browser already pre-rasterizes all 78 pages to 96-DPI JPEGs in storage; signed URLs cost the edge function ~nothing per page; the AI request body is sized by image count, not file size. The reason the caps exist is historical (server-side MuPDF could OOM on 50-page batches), and that path is gone.

## The fix in three layers

### 1. Replace the AI page cap with smart per-discipline batching

Instead of "send the first 10 pages and pray," chunk each discipline's sheets into AI-sized batches and merge findings. Architectural with 74 sheets becomes ~9 calls of 8 sheets each, every sheet seen exactly once, with the 2 General sheets seeded into every call as today.

```text
BEFORE                                    AFTER
discipline=Architectural (74 sheets)      discipline=Architectural (74 sheets)
  pick first 10 → 1 AI call                 chunk into 8-sheet batches → 9 AI calls
  64 sheets ignored                         every sheet seen, findings de-duped per chunk
```

Chunk size constant `DISCIPLINE_BATCH = 8` sheets per call (Gemini 2.5 Flash handles 8 + 2 general images comfortably). Concurrency: keep it sequential per discipline; disciplines themselves already run sequentially in `disciplinesToRun`. Total cost on a 78-sheet job: ~12 vision calls instead of 9 (the existing 9 disciplines × 1 call). Wall time stays manageable because each call gets *fewer* images, not more.

Add a per-review hard ceiling so a 500-page set can't run away: `MAX_SHEETS_PER_DISCIPLINE = 40` (5 chunks). Above that we still chunk, but log a structured warning row so reviewers know coverage was bounded — same UX pattern as the existing page-cap banner, but with truthful numbers.

### 2. Drop the viewer's display cap & rewrite the banner

`usePdfPageRender` already streams pages with progress; rendering 78 pages on a modern laptop is 4-8 seconds. Remove the `Math.min(total, 10)` and the `, 10, 150)` cap arg in `renderPDFPagesToImages`. Add **lazy rendering with virtualization**: render the first 10 pages eagerly (so the viewer is interactive instantly) and the remaining 68 in an idle-callback queue while the user starts triaging. The progress bar already exists — reuse it.

Replace the misleading "Limited review — first 10 of 78 sheets" banner with an honest "Coverage" pill in the workspace header that reads from a new `review_coverage` row written by the pipeline:

```text
sheets total : 78
sheets reviewed by AI : 78    (or 40 if hit ceiling)
sheets per discipline (popover):
  Architectural  74/74
  Structural      0/0
  MEP             0/0
  …
```

### 3. Verify & cross-check stages already chunk; just align them

`stageVerify` is already batched (`BATCH = 3`) but caps each batch's image set to `pages.slice(0, 5)` — i.e., it can verify a finding against at most 5 sheet pages. This is fine for verification (most findings cite ≤3 sheets) but should derive the limit from the finding's `page_indices`, not a fixed 5. One-line change.

`sheet_map` already chunks at `BATCH = 4` over **every** page — no cap. ✅ That's why all 78 pages got mapped on Porsche even though discipline review only saw 10.

---

## Other quality & efficiency wins (no behavioral risk)

These came up while tracing the Porsche flow. All are additive and pure cleanup.

### A. Stop signing 78 URLs every stage

`signedSheetUrls()` is called from `sheet_map`, `dna_extract`, `discipline_review`, `verify`, `dedupe`, etc. The in-memory `_pageManifestCache` only survives a single edge invocation, so any stage that runs in a fresh worker re-signs all 78. Two cheap fixes:

- Sign URLs **lazily**: only sign the page indices a stage actually needs. `discipline_review` for Architectural only needs Architectural + General page indices, not all 78. Most stages already filter, but `signedSheetUrls()` returns the full set.
- Bump signed-URL TTL from 1h → 6h and cache the resolved URLs on `plan_review_page_assets.cached_signed_url` / `cached_until` so re-runs reuse them. Saves ~75 storage round-trips per re-run on a big set.

### B. The browser pre-rasterizer is doing 96 DPI / 0.72 quality. The vision calls want 220 DPI

`rasterizeAndUploadPages` writes 96 DPI JPEGs. AI vision requests then re-fetch those same JPEGs and the model gets the lower-res version. The 220-DPI `renderPDFPagesForVision` path exists but isn't used by the upload pipeline — only for client-side scoring. That's fine for the *display* viewer, but `discipline_review` would benefit from a **separate `pages-vision/` JPEG set at 150 DPI / 0.85 quality** uploaded once at upload time. Trades ~3× storage per page (cheap) for visibly better OCR on small text in title blocks and code summaries — which is exactly where DNA extract currently misses fields.

Manifest gets a sibling column `vision_storage_path` and the AI vision calls load from that. Display viewer continues to use the 96 DPI set.

### C. `runDisciplineChecks` rebuilds the same prompt context per discipline

`dnaSummary` and `jurSummary` are computed *once* per `stageDisciplineReview` call, but the system prompt itself is rebuilt inside `runDisciplineChecks` for every discipline. Hoist the static parts (FBC edition, county snapshot, jurisdiction notes) into a single string built once per stage, then append discipline-specific sections. Pure code-cleanup, ~80 lines simpler.

### D. Dead-code sweep enabled by removing the caps

- Delete `MAX_DISCIPLINE_PAGES` constant.
- Delete the `total > rendered` page-cap banner in `PlanReviewDetail.tsx` and the `pageCapInfo` state in `usePdfPageRender`.
- Delete `renderingPages && pageImages.length === 0` skeleton — replace with the new progress-bar-while-rendering UI.
- Delete the `MAX_PAGES_PER_PDF` references that survived the prior cleanup (already only in dead JSDoc, but search confirmed).

### E. Realtime subscription surface

`useReviewDashboard` resubscribes to `deficiencies_v2` realtime per render in some flows. Memo the channel key on `plan_review_id`. Small, but reduces flapping when a long discipline_review streams in 9 batches of findings instead of 1.

### F. Review-coverage row + dashboard health chip

New table `review_coverage(plan_review_id, sheets_total, sheets_reviewed, by_discipline jsonb, capped_at int|null, updated_at)`. Written at the end of `stageDisciplineReview`. The Health Strip "Coverage" chip reads from this and turns amber if `sheets_reviewed < sheets_total` for any discipline. Replaces the cosmetic 10/78 banner with a real, per-discipline truth.

---

## Files changed

```text
EDIT
  supabase/functions/run-review-pipeline/index.ts
    • runDisciplineChecks: chunk discipline pages into batches of 8,
      merge findings; remove MAX_DISCIPLINE_PAGES; respect
      MAX_SHEETS_PER_DISCIPLINE = 40
    • stageDisciplineReview: write review_coverage row at end
    • signedSheetUrls: accept optional pageIndices filter
    • stageVerify: derive image cap from finding.page_indices, drop the .slice(0,5)
    • Hoist static prompt context out of runDisciplineChecks
  src/lib/pdf-utils.ts
    • renderPDFPagesToImages: drop default cap; add streaming yield hook
    • Add new rasterizeAndUploadVisionPages (150 DPI / 0.85) writing to
      plan-reviews/<id>/pages-vision/
  src/lib/plan-review-upload.ts
    • Call rasterizeAndUploadVisionPages alongside rasterizeAndUploadPages
    • Persist vision_storage_path on plan_review_page_assets
  src/lib/reprepare-in-browser.ts
    • Same: produce both display + vision JPEG sets
  src/hooks/plan-review/usePdfPageRender.ts
    • Remove 10-page cap; render first 10 eagerly + the rest via
      requestIdleCallback queue; expose phase: 'eager' | 'background' | 'done'
  src/pages/PlanReviewDetail.tsx
    • Replace pageCapInfo banner with read from review_coverage
  src/components/review-dashboard/ReviewHealthStrip.tsx
    • Coverage chip reads from review_coverage; amber when <100%
  src/hooks/useReviewDashboard.ts
    • Memo realtime channel key

CREATE
  src/components/review-dashboard/CoverageChip.tsx
    • Per-discipline coverage popover (sheets_reviewed / sheets_total)

MIGRATIONS
  + plan_review_page_assets.vision_storage_path text
  + plan_review_page_assets.cached_signed_url text
  + plan_review_page_assets.cached_until timestamptz
  + new table review_coverage (plan_review_id pk, jsonb breakdown, capped_at)
  + RLS: review_coverage matches plan_reviews firm scoping
```

## Verification after edits

- Re-run the Porsche review → `review_coverage.by_discipline.Architectural` = `{reviewed: 74, total: 74}`.
- Page-cap banner no longer renders on the workspace; replaced by Coverage chip.
- Edge logs: `discipline_review` for Porsche shows ~9 batches × Architectural, not 1.
- A re-run of the same review reuses cached signed URLs (storage call count drops).
- Verifier still upholds/overturns at the same rates on findings whose page_indices ≤ 3.

No edge-function contract changes (dispatcher payload unchanged). No keyboard or UX-noise regressions — Coverage chip slots into the existing health strip.

