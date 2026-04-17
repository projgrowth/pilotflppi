

# 30,000-Foot Audit — Where Precision & UX Are Bleeding

I read the AI pipeline, the wizard, the viewer, the migrations, and the page surface. The recent grid-anchor work helped, but there are deeper structural gaps holding the product back. Here are the **highest-leverage** fixes, ranked by impact.

## Tier 1 — Precision is being capped by the wrong assumption

### 1. We're using the rendered raster as ground truth instead of the PDF's own text layer
PDFs from architects/engineers are vector + embedded text 99% of the time. We're throwing all that away — rendering to PNG at 220 DPI and asking a vision model to read text that's literally already extractable as strings with exact `(x, y, width, height)` coordinates from `pdfjs`. This is the single biggest precision win available.

**Fix**: Run `pdfjs.getTextContent()` per page during render. Extract every text item with its bbox, build a per-page text index, and pass the model both the image AND a JSON manifest like `{cell: "H7", text_items: ["A.1", "DETAIL 3", "BR1", "TYP"]}`. Then on the way back, snap the AI's `nearest_text` to the **actual coordinates** of the matching text item — not the cell center. Pin precision goes from ~10% (one cell) to ~1% (one callout bubble).

### 2. We hard-cap at 10 pages per file
`renderPDFPagesForVisionWithGrid(file, 10, 220)` silently drops everything past page 10. Real plan sets are 40–200 sheets. Findings on sheets 11+ literally cannot exist. Worse: there's no warning to the user that we truncated.

**Fix**: (a) Surface a banner: "Reviewing first 10 of 47 sheets — upgrade to full review." (b) Tier the pages: send all sheets to a cheap classifier first (sheet type from title block via text-layer extraction), then send only the relevant disciplines to the expensive vision pass. That gets you full coverage without 5× the cost.

### 3. Sheets are sent at one zoom level — dense E-size sheets lose detail
A 36"×24" sheet at 220 DPI is ~7900×5300 px, then resampled by the model. Small callout bubbles become 8-pixel blobs. The grid bounds the error but doesn't fix the underlying readability.

**Fix**: For sheets the model flagged with low confidence on the first pass, re-send a **2× zoom crop** of just the implicated grid cell + neighbors. Two-pass review with cheap first-pass classification, expensive zoomed second-pass on flagged regions only.

## Tier 2 — UX gaps the user will feel today

### 4. No visible progress on long AI runs
`runAICheck` can take 60–120s on a real plan set. The streaming step exists for the comment letter but the vision-extraction step shows a spinner with no per-step state. Users think it's frozen and refresh.

**Fix**: Use the existing `SCANNING_STEPS` machinery (already imported but underused) to drive a real step indicator: "Reading title blocks → Extracting text → Vision pass page 4/10 → Validating findings → Done." The infrastructure is already there.

### 5. No "review the AI" workflow — just accept/reject per-finding
Every finding is treated equally. There's no batched triage view ("show me all the medium-confidence MEP findings"), no bulk dismiss, no "I've reviewed sheet S-101, mark all its findings reviewed."

**Fix**: Add a confidence + discipline + sheet filter chip strip on the findings panel, plus a "mark all on this sheet reviewed" action. This is a one-day change that transforms reviewer throughput.

### 6. No diff between rounds
`previous_findings` exists in the schema but isn't used in the UI. Round 2 of a review should clearly show "3 new, 5 still open, 4 resolved since round 1" — instead it looks like a fresh review.

**Fix**: Wire a round-comparison header that diffs by `code_ref + page` and tags findings as `new | persisted | resolved | newly-resolved`. Critical for the comment-letter generation step too — the letter should focus on what changed.

## Tier 3 — Trust & defensibility (Private Provider risk)

### 7. No audit trail of WHY the AI flagged something
The finding stores the `description` and `code_ref` but not the model's reasoning, the image region it analyzed, or which version of the prompt was used. When a building official questions a finding, the firm can't reconstruct it.

**Fix**: Persist the cropped pin region (a small JPEG) + a short `reasoning` field per finding into Storage. Show a "Why was this flagged?" disclosure on each card. Also stamp every finding with `prompt_version` and `model_version` so audits work after we change prompts.

### 8. The AI learning loop exists but has no visible feedback
The `process-correction` and `get-similar-corrections` edge functions exist but there's no UI signaling "we've seen this kind of finding corrected 12 times — confidence reduced." Users don't know corrections matter.

**Fix**: When a similar correction exists, show a small badge on the finding: "Similar finding was corrected 12 times before — review carefully." Closes the loop visibly.

### 9. No QC sign-off gate before letter export
`qc_status` exists in the schema. There's no UI enforcing that a letter can't be exported until QC is signed off — which is a Private Provider statutory requirement under FS 553.791.

**Fix**: Block `CommentLetterExport` behind a QC sign-off action (signed by a different user than the reviewer). One state-machine guard, big legal protection.

## Tier 4 — Quick wins (each <1 day)

- **Title-block extraction telemetry**: log how often auto-extracted address/county/jurisdiction was edited by the user — that's your accuracy KPI for the new wizard.
- **Geocoder cache**: a 1-table key/value cache on normalized address → county/jurisdiction. Cuts repeat Nominatim calls and avoids their 1 req/s rate limit.
- **Empty-state illustrations**: most pages (Inspections, Invoices, LeadRadar) show a bare empty state. Add a one-line CTA + sample data toggle.
- **No keyboard shortcuts in the viewer**: arrow keys for next/prev finding, `R` to reposition, `D` to dismiss. Power users review 10× faster.

## What I'd ship first (this week)

1. **PDF text-layer extraction + nearest-text snapping** (Tier 1.1) — biggest precision unlock, stays inside existing arch.
2. **Page-cap banner + step indicator** (Tier 2.4 + 1.2 partial) — kills two complaints in one change.
3. **Round diff header** (Tier 2.6) — makes round 2+ usable, sells the product.
4. **QC gate on letter export** (Tier 3.9) — legal must-have before more customers.

Everything else is incremental. The text-layer extraction is the move that changes the product's accuracy ceiling — without it we're forever fighting vision-model imprecision with cleverer overlays.

