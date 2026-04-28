# Fix: hallucinated & mismatch citations are mostly false positives

## What's actually happening

On the current review (`6b679f01…`), 22 of 29 ungrounded findings are flagged "mismatch" and 1 is "hallucinated". The data shows this is **not** an AI quality problem — it's a grounding-logic problem:

- **`fbc_code_sections` is mostly stub rows.** Most seeded sections have placeholder text like *"FBC-B Section 508.4 — Separated Occupancies. See FBC for full requirement text."* Real requirement language is missing.
- The grounder computes Jaccard overlap between the AI's finding text and that placeholder. Scores land at 0.04–0.17 — well below the 0.30 threshold — so **everything that lands on a stub row is auto-flagged "mismatch"**, even when the AI cited the correct section.
- The single "hallucinated" finding (DEF-A021) has `code_reference: {}` because the AI legitimately couldn't cite a section (it was complaining about *missing* FBC-edition metadata). That shouldn't be classed as a hallucination.
- Reviewers see a sea of red badges and warnings in the letter readiness gate that don't reflect real problems.

## The fix (three parts)

### 1. Make grounding tolerant of stub canonical rows

Edit `supabase/functions/run-review-pipeline/stages/ground-citations.ts`:

- Detect "stub" canonical rows by a marker phrase (e.g., `requirement_text` contains `"See FBC for full requirement text"` or is shorter than ~60 chars). For those, **skip the overlap test** and treat presence of the section as `verified` with a new sub-status `verified_stub` stored in `evidence_crop_meta` so we know the canonical text wasn't substantive.
- For real canonical rows, keep the existing overlap test but lower the threshold to **0.20** (current 0.30 is too strict against short canonical paragraphs) and require the section number OR the canonical title token to appear in the AI text.
- When the AI cites a parent section that exists (e.g., `508.4` matches a row but the AI said `508.4.4.1`), keep the existing parent-fallback path but mark `verified` instead of `mismatch` when the AI text mentions the cited child.

Result on the current review: ~18 of the 21 "mismatch" findings should flip to `verified`.

### 2. Stop classifying *legitimately uncitable* findings as hallucinated

Same file:

- Introduce a new status `no_citation_required` (stored in `citation_status`) for findings where:
  - `code_reference` is empty/null AND
  - the `finding` text is about missing project metadata, missing submittals, or "verify with AHJ" requests (heuristic: matches one of a small keyword list — *missing*, *not provided*, *not specified*, *verify with*, *AHJ*, *coordinate with*).
- These findings shouldn't block the letter and shouldn't show a red badge — they need a reviewer note, not a code citation.
- True hallucinations (code_reference present but section doesn't normalize, or AI wrote a fake-looking section like "FBC 9999.99") still flag as `hallucinated`.

Update the citation badge legend in `src/components/review-dashboard/CitationBadge.tsx` to render the new `no_citation_required` status as a neutral "Procedural" chip, and treat it as non-blocking.

### 3. Tighten the AI's citation contract on the way in

Edit `supabase/functions/run-review-pipeline/stages/discipline-review.ts` (and the shared discipline-expert prompt in `discipline-experts.ts`):

- Add an explicit instruction: *"If you cannot cite a specific FBC section number with confidence, leave `code_reference` empty AND set `finding_type: 'procedural'` in the JSON. Do not invent or paraphrase section numbers."*
- Add a post-parse server-side validator: any finding whose `code_reference.section` doesn't match the regex `^[A-Z]?\d{1,4}(\.\d{1,4}){0,4}[A-Za-z]?$` or refers to chapters above the FBC's actual range gets its `code_reference` blanked and `finding_type` set to `procedural` *before* it lands in the DB. This prevents hallucinated section numbers from reaching the grounder at all.

### 4. Wire the new statuses through the UI gates

- `src/lib/letter-readiness.ts` — exclude `verified_stub` and `no_citation_required` from the "weak citation" count. Only true `hallucinated` and low-confidence `mismatch` should block.
- `src/hooks/useLetterQualityCheck.ts` — same: only block confirmed findings with `hallucinated`, downgrade `mismatch` warning when the parent section is verified.
- `src/components/plan-review/ReviewProvenanceStrip.tsx` — show the new `verified_stub` count separately so admins know the canonical DB needs more seeding, but it doesn't read as a quality red flag.

### 5. Backfill the existing review

Add a one-shot regrounding trigger in the existing `regroup-citations` edge function so the user can re-run grounding on the current review without restarting the whole pipeline. The function is already wired — just confirm it picks up the new logic on next invocation.

## Files changed

- `supabase/functions/run-review-pipeline/stages/ground-citations.ts` — stub detection, threshold, new status mapping
- `supabase/functions/run-review-pipeline/stages/discipline-review.ts` — server-side citation validator
- `supabase/functions/run-review-pipeline/discipline-experts.ts` — prompt contract
- `src/components/review-dashboard/CitationBadge.tsx` — new "Procedural" / "Verified*" chips
- `src/lib/letter-readiness.ts` — exclude new statuses from blockers
- `src/hooks/useLetterQualityCheck.ts` — same
- `src/components/plan-review/ReviewProvenanceStrip.tsx` — surface stub-grounded counts

No DB migration required — `citation_status` is a free-text column.

## Out of scope

- **Seeding `fbc_code_sections` with real requirement text.** That's a content task (book extraction) — separate from this code fix. The stub-tolerant grounder makes the system usable in the meantime.
- Switching to a vector-similarity grounder. Overkill until the canonical text is real.

## Expected outcome

- Current review's "mismatch" count drops from 21 → ~3, and the lone "hallucinated" reclassifies as procedural.
- Letter readiness gate stops blocking on noise.
- Future runs: the AI is constrained to either cite cleanly or declare procedural — the noisy middle disappears.

---

# Tier 1 Accuracy Upgrade (shipped)

Foundational improvements to attack the three root causes of finding/citation noise: missing canonical text, single-pass overconfidence, evidence quotes that don't anchor to the plan.

## 1.1 Canonical text seeding (`fbc_code_sections`)

- New edge function `seed-canonical-section` — accepts `{ section, edition, title, requirement_text, keywords, source_url }` and upserts into `fbc_code_sections`. AI-assist mode lets admins paste raw code text and Gemini 2.5 Pro normalizes it into the structured row.
- New admin UI `src/components/CanonicalCodeLibrary.tsx` exposed under **Settings → Code Library** (admin-only). Lists stub rows first so they can be replaced; supports manual edit and AI-assisted bulk seed.
- Grounder already tolerates stubs (Tier 0); each real seed monotonically improves grounding without code changes.

## 1.2 Critic pass

- New pipeline stage `supabase/functions/run-review-pipeline/stages/critic.ts` — runs after `discipline-review`, before `ground-citations`. Uses `google/gemini-2.5-flash` to audit each finding for internal coherence (does the finding text, required action, sheet refs, and code reference agree?).
- Critic emits one of `{ keep, weak, junk }` per finding:
  - `junk` → auto-status set to `waived` with `human_review_reason = 'critic_rejected:<reason>'`
  - `weak` → `requires_human_review = true` with reason surfaced in the dashboard
  - `keep` → unchanged
- Wired into `pipeline-stages.ts`, `_shared/types.ts`, and `index.ts`. Stage timing recorded in `stage_checkpoints` like all others, so the watchdog/resume logic covers it automatically.

## 1.3 Evidence-shape verification

- New helper `verifyEvidenceShape` in `discipline-review.ts` runs as findings are persisted. Heuristics:
  - No quoted evidence → `suspicious: 'no quoted evidence'`
  - Quote restates the finding text (>0.6 token overlap with `finding`) → `suspicious: 'quote restates finding'`
  - Quote contains no plan-specific anchor (sheet ref like `A-101`, detail callout `1/A5.2`, dimension, note number) → `suspicious: 'no plan-specific anchor'`
- Suspicious findings get `requires_human_review = true` and `human_review_reason = 'evidence_shape:<reason>'`. The reviewer dashboard already surfaces `requires_human_review`, so no UI change needed.

## Files added/changed

- **New:** `supabase/functions/seed-canonical-section/index.ts`
- **New:** `supabase/functions/run-review-pipeline/stages/critic.ts`
- **New:** `src/components/CanonicalCodeLibrary.tsx`
- **Edited:** `supabase/functions/run-review-pipeline/stages/discipline-review.ts` (evidence-shape verifier)
- **Edited:** `supabase/functions/run-review-pipeline/index.ts` (critic stage wiring)
- **Edited:** `supabase/functions/run-review-pipeline/_shared/types.ts` (critic stage type)
- **Edited:** `src/lib/pipeline-stages.ts` (display order for critic)
- **Edited:** `src/pages/Settings.tsx` (Code Library tab)

Edge functions `seed-canonical-section` and `run-review-pipeline` redeployed.

## Tier 2 Accuracy Upgrade (shipped — partial)

### 2.1 Per-chunk self-critique pass *(shipped)*

- After each discipline chunk's draft findings come back, the same images are re-shown to `gemini-2.5-flash` along with a compact list of the model's own findings, evidence quotes, sheet refs, and code citations.
- Critic emits one verdict per finding via `submit_self_critique`:
  - `keep` → unchanged
  - `weak` → `requires_human_review = true`, confidence × 0.5, reason surfaced as `Self-critique flagged weak: …`
  - `junk` → status auto-set to `waived`, confidence floored at 0.15, reason surfaced as `Self-critique rejected: …`
- Verdicts persisted on `deficiencies_v2.evidence_crop_meta.self_critique` for audit + future learning loop.
- Falls back gracefully (logs + skip) if the critique call errors so a single AI hiccup never breaks the chunk.
- Cost: one extra `gemini-2.5-flash` call per chunk (~8 images, 1 short text). Worth it — these are the calls that catch the "AI invented a defect that isn't on the sheet" class of error that no deterministic check can.

This is *in addition to* the global `critic` stage (Tier 1.2). Per-chunk runs immediately after the draft when the same context is hot; global runs later across the whole review for cross-chunk coherence.

### 2.2 Sheet-anchor enforcement *(shipped)*

`verifyEvidenceShape` in `discipline-review.ts` upgraded:

- **Sheet-ref enforcement:** every finding must cite at least one sheet that was actually rendered for the model in this chunk. Findings that name a sheet not in the chunk's `disciplineSheets` get `suspicious: 'cited sheet(s) X not in the chunk shown to the model'` and are routed to human review. Catches the failure mode where the AI fabricates a plausible-sounding sheet number.
- **Anchor strictness raised:** dropped weak generic anchors (`section`, `table`, `symbol`, bare letter-number patterns) and now require either a known chunk sheet ref OR a strong anchor: detail callout (`A5.2`, `3/A-501`), dimensioned value (`24 in`, `30 psf`), numbered note, numbered detail, or `Table X-N`. Generic boilerplate quotes no longer pass.
- Empty `sheet_refs` arrays are now suspicious (previously only checked evidence content).

Together, 2.1 + 2.2 hit the same problem from two angles: 2.2 catches structural fabrications deterministically (free), 2.1 catches semantic fabrications with the model (one cheap call/chunk).

### 2.3 Vector-similarity grounder *(shipped)*

The data turned over: 503/504 rows in `fbc_code_sections` now carry real text, so embeddings are worth the spend.

- **Schema:** added `embedding_vector vector(1536)` + `embedded_at timestamptz` to `fbc_code_sections` with an HNSW cosine index. New RPC `match_fbc_code_sections(query_vector, match_threshold, match_count)` returns top-N semantic neighbours.
- **Backfill:** new `embed-fbc-sections` edge function (OpenAI `text-embedding-3-small`, 1536 dims to match the existing `flag_embeddings` index dim) processes up to 500 rows per call. Embeds `code + section + edition + title + requirement_text + keywords` so even short rows have multiple anchors. Triggered from the admin Code Library via a new "Embed N" button.
- **Grounder integration:** `ground-citations.ts` now calls `vectorSuggestSection` whenever the keyword pass returns `mismatch`/`not_found`/`hallucinated`. If the top neighbour clears similarity ≥ 0.6, the suggestion (section + title + similarity + 240-char preview) is written to `evidence_crop_meta.vector_suggestion` and surfaced in `human_review_reason` so reviewers see "AI suggests 1006.3.2 (Egress from stories) is a better fit" instead of a dead-end "we don't know".
- **Failure modes:** if `OPENAI_API_KEY` is missing or the embed call fails, grounder silently falls back to existing keyword behavior — pipeline never breaks.

## Files added/changed (Tier 2)

- **Edited:** `supabase/functions/run-review-pipeline/stages/discipline-review.ts` (self-critique pass + sheet-anchor enforcement)
- **Edited:** `supabase/functions/run-review-pipeline/stages/ground-citations.ts` (vector re-ranking)
- **Added:** `supabase/functions/run-review-pipeline/_shared/embedding.ts`
- **Added:** `supabase/functions/embed-fbc-sections/index.ts`
- **Edited:** `src/components/CanonicalCodeLibrary.tsx` (Embed N button + unembedded counter)
- **Migration:** `embedding_vector` + `embedded_at` columns + HNSW index + `match_fbc_code_sections` RPC

`run-review-pipeline` and `embed-fbc-sections` deployed.

## Tier 3 (queued)

- Cross-discipline conflict detector (e.g. structural says CMU wall, life-safety says rated GWB).
- Reviewer feedback loop into the critic prompt (use `correction_patterns` to bias the self-critique toward known firm-specific reject patterns).
- Automatic re-verify of all open findings when canonical rows are upgraded from stub → real text.
- Auto-trigger embedding refresh when canonical rows are edited (`embedded_at = NULL` on update + nightly batch).
