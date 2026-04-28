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

## Tier 3 Accuracy Upgrade (shipped)

### 3.1 Cross-discipline conflict detector *(shipped)*

New sub-pass inside `cross_check` (`runCrossDisciplineConflicts`). Groups open findings by sheet, keeps only sheets where 2+ disciplines have entries, and asks `gemini-2.5-flash` to identify pairs from DIFFERENT disciplines that make contradictory claims about the same element (classic case: structural says CMU wall, life-safety says rated GWB on the same partition). Confirmed conflicts (confidence ≥ 0.7) are persisted as `DEF-XD###` rows tagged `discipline=cross_sheet`, with both source finding IDs stored in `evidence_crop_meta.cross_discipline_conflict_with` so the UI can cross-link them later. Capped at 6 sheets/24 findings per call to bound cost. Falls back gracefully on AI failure.

### 3.2 Critic learns from `correction_patterns` *(shipped)*

`stageCritic` now loads up to 12 active `correction_patterns` for the current firm filtered to disciplines present in this run, ordered by `rejection_count desc`. Each pattern's summary + rejection reason is appended to the critic system prompt as a "this firm previously rejected findings shaped like X because Y" block, so the critic preferentially flags repeats as `weak`/`junk`. Result metadata reports `used_learned_patterns` so we can tell when the bias was active. Zero impact on firms without correction history.

### 3.3 Re-verify findings on canonical upgrades *(shipped)*

DB trigger `flag_findings_for_reground_on_canonical_change` fires AFTER UPDATE on `fbc_code_sections`. When `requirement_text` changes AND the new text is non-stub (≥60 chars, no placeholder marker), the trigger sets `citation_status = 'unverified'` and `citation_grounded_at = NULL` on every open `deficiencies_v2` row whose `code_reference->>section` matches the upgraded section. Reviewers can then click the existing **"Re-ground citations"** button to re-run grounding against the now-real canonical text — the previously-`mismatch` findings will flip to `verified`.

### 3.4 Auto-clear embedding on canonical edit *(shipped)*

DB trigger `clear_fbc_embedding_on_text_change` fires BEFORE UPDATE on `fbc_code_sections`. If `requirement_text`, `title`, or `keywords` change, both `embedding_vector` and `embedded_at` are nulled out so the next admin click of **"Embed N"** in the Code Library picks up the row. Prevents stale vectors from silently grounding findings against outdated canonical text.

## Files added/changed (Tier 3)

- **Edited:** `supabase/functions/run-review-pipeline/stages/cross-check.ts` (cross-discipline conflict detector)
- **Edited:** `supabase/functions/run-review-pipeline/stages/critic.ts` (learned-pattern bias)
- **Migration:** `clear_fbc_embedding_on_text_change` BEFORE UPDATE trigger + `flag_findings_for_reground_on_canonical_change` AFTER UPDATE trigger on `fbc_code_sections`

`run-review-pipeline` redeployed.

## Tier 4 Accuracy Upgrade (shipped)

### 4.1 Cross-discipline conflict chips on linked findings *(shipped)*

`DeficiencyHeader` now reads the cached `deficiencies_v2` query data and looks for any `DEF-XD*` row whose `evidence_crop_meta.cross_discipline_conflict_with` array contains the current finding's id. When found, an amber **XD CONFLICT ↔ DEF-X##** chip renders next to the existing flag tags, with a tooltip naming the contradicting finding's def number, discipline, and the parent reconciliation row. No new query — purely derived from the data the dashboard already loads.

### 4.2 Auto-trigger embedding refresh *(shipped)*

`seed-canonical-section` now fires a non-awaited `embed-fbc-sections` invocation (limit 25) after every successful upsert. The pre-existing `clear_fbc_embedding_on_text_change` trigger has already nulled the row's vector by the time the embed call runs, so the refresh picks it up automatically. Admins no longer need to click "Embed N" after editing canonical text.

### 4.3 Correction-pattern decay *(shipped)*

`loadFirmRejectPatterns` in `critic.ts` now considers `last_seen_at`:

- Patterns older than **180 days** are dropped entirely (no longer bias the critic).
- Patterns older than **60 days** are kept but tagged `[stale, advisory]` in the prompt block, with explicit instructions telling the model to weigh them less than fresh patterns.
- Pulls 40 candidates from the DB, filters by age, takes the top 12 by `rejection_count`.

Result: the critic stops being dragged by ancient firm preferences while still respecting recent reviewer corrections.

## Files added/changed (Tier 4)

- **Edited:** `src/components/review-dashboard/deficiency/DeficiencyHeader.tsx` (XD conflict chip)
- **Edited:** `supabase/functions/seed-canonical-section/index.ts` (auto-invoke embed refresh)
- **Edited:** `supabase/functions/run-review-pipeline/stages/critic.ts` (pattern decay)

`run-review-pipeline` and `seed-canonical-section` redeployed.
