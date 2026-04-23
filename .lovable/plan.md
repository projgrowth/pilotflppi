
## Simplify the review pipeline into a fast, precise “Core Review” path

### What to strip down

The current flow is doing too many sequential AI passes after upload, and two of them are hidden from the stepper:

```text
upload
prepare_pages
sheet_map
dna_extract
discipline_review
verify
dedupe
ground_citations
cross_check      <- hidden in current stepper
deferred_scope   <- hidden in current stepper
prioritize
complete
```

That creates two problems:
1. It feels like the system is “working forever” even when visible steps look done.
2. Precision work is being spread across too many stages, so latency and failure surface area are high.

### Proposed simplification

#### 1. Make the default pipeline “Core Review” only
Keep only the stages that generate the main review accurately:

```text
upload
pages_ready
sheet_map
dna_extract
discipline_review
dedupe
complete
```

Implementation intent:
- `upload` = validate files exist.
- `pages_ready` = client-rasterized pages already uploaded; no server raster loop in the default path.
- `sheet_map` = keep.
- `dna_extract` = keep.
- `discipline_review` = keep as the main precision stage.
- `dedupe` = keep because it is deterministic cleanup.
- `complete` = keep for comment-letter output.

#### 2. Move the expensive “QA / enrichment” stages out of the default run
Remove these from the automatic first pass:
- `verify`
- `ground_citations`
- `cross_check`
- `deferred_scope`
- `prioritize`

Instead, expose them as a secondary action:
- “Run Deep QA”
- or “Enrich findings”

That way the user gets results fast first, then can opt into heavier validation only when needed.

### Why this keeps precision

Most of the actual finding quality comes from:
- correct page assets,
- correct sheet routing,
- correct project DNA,
- disciplined sheet-by-sheet review.

Those are already concentrated in:
- `sheet_map`
- `dna_extract`
- `discipline_review`

The later stages mostly:
- re-audit findings,
- enrich citations,
- look for cross-sheet mismatches,
- detect deferred scope,
- reprioritize.

They can improve confidence, but they are not required to get a solid first-pass review. To preserve precision after stripping stages:
- tighten `discipline_review` prompts,
- keep evidence-only findings,
- keep `requires_human_review` when evidence is weak,
- optionally upgrade just the core discipline pass to a stronger model since there will be fewer total AI calls.

### Additional simplifications to reduce churn

#### 3. Remove server-side `prepare_pages` fallback from the default path
The upload wizard already pre-rasterizes pages in the browser and inserts `plan_review_page_assets`.

So the default pipeline should:
- trust pre-rasterized assets,
- verify manifest completeness,
- fail fast if they are missing,
- not fall back to MuPDF chunking unless explicitly running a rescue path.

This removes the most failure-prone part of the system.

#### 4. Stop creating “no sheets found” pseudo-deficiencies for absent disciplines
`discipline_review` currently loops through all disciplines and inserts human-review items when no sheets are routed.

Simplify that to:
- run only on disciplines that actually have mapped sheets,
- optionally keep a lightweight warning in stage metadata instead of inserting a deficiency row.

That reduces noise and DB churn without hurting review quality.

#### 5. Align the UI to the actual executed stages
Right now hidden backend stages make the dashboard feel stalled.

Update the stepper so it either:
- shows only the simplified core stages, or
- separates “Core Review” and “Deep QA” into distinct sections.

### Files to change

#### `supabase/functions/run-review-pipeline/index.ts`
- Add a pipeline mode, e.g. `mode: "core" | "deep"`, defaulting to `"core"`.
- Reduce the default stage order to the core set.
- Convert `prepare_pages` into a manifest-validation / fast-pass stage for pre-rasterized uploads.
- Remove automatic scheduling of `verify`, `ground_citations`, `cross_check`, `deferred_scope`, and `prioritize` from the default chain.
- Change `discipline_review` to run only on disciplines with routed sheets.
- Keep `dedupe` and `complete` in the default path.
- Keep the stripped stages callable via an explicit deep-QA trigger.

#### `src/components/NewPlanReviewWizard.tsx`
- Launch the pipeline in `core` mode by default.
- Fail early if the expected pre-rasterized page count does not match what was registered.
- Update user messaging so the first pass is positioned as “core analysis.”

#### `src/hooks/useReviewDashboard.ts`
- Update the canonical stage list for the default mode.
- If deep QA remains available, add a second stage set or metadata flag so the UI can distinguish it cleanly.

#### `src/components/plan-review/PipelineProgressStepper.tsx`
- Show only the simplified default stages.
- Remove the confusing hidden-work gap.
- If deep QA is added later, present it as a separate optional sequence rather than silent continuation.

#### `src/pages/ReviewDashboard.tsx`
- Add a “Run Deep QA” action after core review completes.
- Keep the existing rerun action for full reruns, but default it to core mode.

### Expected result

- Much shorter time-to-first-results.
- No “it keeps working forever” feeling from hidden post-processing.
- Fewer background retries and fewer failure points.
- Better user trust because the UI matches what is actually happening.
- Precision stays high because the core evidence-generation path remains intact.

### Technical details

#### New default pipeline
```text
Core Review:
upload -> pages_ready -> sheet_map -> dna_extract -> discipline_review -> dedupe -> complete
```

#### Optional second pass
```text
Deep QA:
verify -> ground_citations -> cross_check -> deferred_scope -> prioritize
```

#### Precision guardrails to keep
- Require quoted evidence in findings.
- Keep human-review escalation for weak/uncertain findings.
- Keep deterministic dedupe.
- Prefer stronger model quality in `discipline_review` if total stage count is reduced.
