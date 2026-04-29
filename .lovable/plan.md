# Wave B: Trustworthy Plan Reviews

Two distinct problems are eroding trust in every review. They have the same root: **the system doesn't fail loud, it fails silent and lets junk reach the reviewer.**

## Problem 1: Pins always land in the top-left corner

### What's happening
`deficiency-adapter.ts → deterministicPin()` returns coordinates as **0–1 floats** (e.g. `x: 0.235`). But `PlanMarkupViewer` reads them as **percentages 0–100** (`left: ${a.x}%`). So `0.235` renders as `0.235%` from the left edge — visually pinned at the trim corner.

I confirmed this in the DB: not a single live finding on the Pizza review has `evidence_crop_meta.page_index` populated, so 100% of pins fall into this broken deterministic path.

### Why every finding hits the broken path
`attachEvidenceCrops` (in `ground-citations.ts`) only writes `page_index` into `evidence_crop_meta` when it can resolve `sheet_refs[0]` against `checklist_state.last_sheet_map`. That sheet map is empty / stale on this review, so resolution fails and meta is never stamped. The adapter then falls through to its broken-coords fallback.

### Fix
1. **Coordinate units (one-line bug)** — `deterministicPin` must return 0–100 (multiply the existing 0.10–0.90 floats by 100, and bump `width/height` to ~3–4 percent so the pin matches the user-reposition default).
2. **Always resolve `page_index`** — when `attachEvidenceCrops` can't find the sheet via `checklist_state.last_sheet_map`, fall back to the canonical `sheet_coverage` table (which IS populated for every review). Today that fallback doesn't exist, so half-broken sheet maps cascade into broken pins.
3. **Pin confidence label is honest** — show `pin_confidence: "low"` as a literal "approximate location" badge with an amber dashed ring (the viewer already supports this; we just need to feed it correctly).

## Problem 2: "Verifier stalled — 11 of 11 unverified / hallucinated citation present"

### What's happening
Three independent failure modes all produce the same scary banner, and we can't tell them apart:

A. **Verifier never ran on this review.** I found 4 historical Pizza reviews where every finding has `verification_meta: {}` and `verification_status: 'unverified'`. The verifier stage either crashed before our retry guard was added, or the run was started before the pipeline reached `verify`. The current Pizza review (`42100eb5…`) actually has 8/11 verified — the screenshot is stale UI.

B. **Hallucinated citations leak through.** `ground-citations` flags a finding as `hallucinated` when it can't parse the cited code section, but it does not delete or hide the finding — it just sets a column. So the reviewer sees a finding with a fabricated section number sitting in the list as if it were real.

C. **Unverified-but-ungrounded findings count toward the 25% stall threshold.** A single finding stuck at `unverified` because of a transient AI gateway 5xx triggers `verifierStalled = unverifiedPct > 0.25` on small reviews (1/4 = 25%). The whole review then shows "Manual review required" even though 75% are clean.

### Fix

1. **Refresh on the dashboard** — the banner reads from a cached `quality_breakdown` snapshot. Subscribe to `deficiencies_v2` realtime updates so the banner re-computes when the verifier finishes; right now you have to hard-reload to see "11 unverified" drop to "1 needs human."

2. **Auto-rerun verifier on stuck reviews** — if a review has been in `verify` for >5 minutes AND there are still `unverified` rows AND the ai_run_progress shows `verify` is the current stage, kick `stageVerify` from `reconcile-stuck-reviews` (the cron is already deployed, it just doesn't know to retry verify).

3. **Hard-suppress hallucinated findings from the letter, by default.** Today `letter-readiness` blocks the letter, but the finding is still shown to the user as if real. Change to: any `citation_status='hallucinated'` finding is auto-set to `status='waived'` with `reviewer_notes: "Auto-waived: AI cited a non-parseable code section"`. The reviewer can un-waive if they want, but the default is "don't trust fabricated citations." Pair with a small toast: _"3 findings hidden — AI couldn't ground their FBC citation"._

4. **Better banner copy + diagnostics.** Replace the one-liner "Verifier stalled — 11 of 11 unverified" with a 3-row breakdown:
   ```
   • 8 verified by adversarial AI
   • 1 needs your eyes (verifier couldn't locate on sheet)
   • 2 awaiting verifier (re-run started 12s ago)
   ```
   The reviewer can see the system isn't broken, just in progress.

5. **Tighten the verifier prompt to reduce false `cannot_locate`.** Today on small sheets (8.5×11 PDFs) the verifier often can't read fine print and bails to `cannot_locate`. Add a fallback: when the page image is < 1500px on the long edge, render the page at 2x DPI just for the verifier batch, and re-prompt. Cost: ~2× tokens on those pages, but turns "needs human" into real verdicts.

6. **Add a "Trust score" header on every review.** A single number 0–100 the reviewer sees at the top:
   ```
   Confidence 78/100 · 8 verified, 1 needs eyes, 2 modified
   ```
   It's a composite of (verified %, citations grounded %, unresolved sheets %, hallucinations × −15). This gives the reviewer one-glance trust before they scroll through 11 cards.

## What this does NOT do

- Does not change the finding-extraction prompts. The hallucinations and weak findings are real but separate from "is the system trustworthy when it does run." Tightening discipline-review prompts is a Wave C item.
- Does not add per-finding bbox detection (real vision-based pinning). That's a much larger lift and should come after this.
- Does not touch Wave B compliance items (statutory pause/resume, CoC gating, firm_id hardening) — that plan still stands and we should resume it next.

## Files touched

- edited: `src/lib/deficiency-adapter.ts` (fix unit bug + sheet_coverage fallback for page resolution)
- edited: `src/components/PlanMarkupViewer.tsx` (already supports low-confidence pins, no real change beyond verifying)
- edited: `supabase/functions/run-review-pipeline/stages/ground-citations.ts` (sheet_coverage fallback in `attachEvidenceCrops`; auto-waive hallucinated findings)
- edited: `supabase/functions/run-review-pipeline/stages/verify.ts` (2× DPI re-prompt on `cannot_locate` for small images)
- edited: `supabase/functions/reconcile-stuck-reviews/index.ts` (resume `verify` stage when stuck)
- edited: `src/components/plan-review/StuckRecoveryBanner.tsx` (3-row breakdown + realtime refresh)
- edited: `src/lib/letter-readiness.ts` (don't count hallucinated/waived in unverified denominator)
- edited: `src/hooks/useReviewDashboard.ts` (subscribe to deficiencies_v2 changes)
- new: `src/components/plan-review/TrustScoreBadge.tsx` (composite score in header)

## Backfill

One-time SQL to auto-waive existing `citation_status='hallucinated'` rows so historical reviews stop showing fake findings.

Approve and I'll ship Wave B-Trust, then we can return to Wave B-Compliance (statutory clock, CoC gating, firm_id) cleanly.