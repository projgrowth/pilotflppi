
Looking at what's shipped vs what's left from the audit, the biggest unshipped wins are:

**Already shipped:** vector text snapping, page-cap banner, phase indicator, round diff, QC gate, audit reasoning + version stamps, keyboard shortcuts, two-pass zoom, bulk triage filters, storage RLS hardening.

**Still on the table from the audit:** image audit crops (Tier 3.7), corrections feedback badge (Tier 3.8), title-block telemetry (Tier 4), geocoder cache (Tier 4), sample-data empty states (Tier 4).

**New gaps I'd add looking at the current state:**
- No durable AI run state — if the user closes the tab mid-`runAICheck`, it dies. There's no resume.
- The corrections learning loop (`process-correction`, `get-similar-corrections` edge functions) exists but nothing surfaces it in the reviewer UI.
- No realtime — two reviewers on one project can stomp each other's status changes.

# Recommendation

Ship **two complementary changes** that together close the trust + throughput loop:

## 1. Image audit crops + corrections feedback (trust)
Building officials challenge findings. Right now the reviewer can show "Why?" text but no image. And the firm has a learning loop running invisibly — corrections happen but never feed back to the reviewer.

**What to build:**
- After two-pass zoom finishes, persist the JPEG crop already in memory to Storage at `plan-reviews/{id}/finding-crops/{findingKey}.jpg`. Store the path on the finding.
- Show the crop inline under the "Why?" disclosure on `FindingCard`.
- On finding render, batch-call `get-similar-corrections` for the visible findings; if N≥3 prior corrections exist for the same `code_ref`, show an amber badge: "Corrected N× before — review carefully."

## 2. Persistent AI run + cross-tab resume (reliability)
Today `runAICheck` lives entirely in component state. Tab close = lost work + wasted Lovable AI credits.

**What to build:**
- Add an `ai_run_progress` JSONB column on `plan_reviews` updated as `aiPhase` changes (already tracked client-side).
- On `PlanReviewDetail` mount, if `ai_check_status === "in_progress"` and `ai_run_progress.updated_at < 2min ago`, show "Resuming review…" and subscribe via Supabase Realtime to progress updates.
- On `runAICheck` start, write progress every phase transition.

# Files

**Trust:**
- `src/lib/pdf-utils.ts` — return crop blob from `renderZoomCropForCell` (already renders it).
- `src/pages/PlanReviewDetail.tsx` — upload crops post-refine, attach `crop_url` to finding.
- `src/types/index.ts` — add `crop_url?: string` and `similar_corrections_count?: number` to `Finding`.
- `src/components/FindingCard.tsx` — render `<img>` under Why? + corrections badge.
- New hook `src/hooks/useSimilarCorrections.ts` — batch lookup with 5-min cache.

**Reliability:**
- New migration: `plan_reviews.ai_run_progress jsonb`.
- `src/pages/PlanReviewDetail.tsx` — write progress on phase change; on mount, detect stale in-progress + subscribe to realtime updates.

# Why these two together

They share one architectural truth: **the finding is the unit of work, not the run**. Crops + corrections badges make each finding self-defending; persistent progress makes the run survivable. After this pair the product is genuinely production-grade for a regulated workflow.

# What I'd defer

- Title-block telemetry — useful but no user complains about it.
- Geocoder cache — only matters at 100+ projects/day; you're not there.
- Sample-data empty states — cosmetic.

# Estimated scope

~6 files touched + 1 migration + 1 new hook. No new dependencies.
