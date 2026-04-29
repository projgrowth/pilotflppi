# Fix "Auto-fill timed out" — speed up title-block extraction

## Root cause (confirmed in edge function logs)

The AI extraction call from `NewReviewDialog` is succeeding, but it's slow. Recent runs against `/functions/v1/ai`:

| run | duration | status |
|---|---|---|
| 1 | 6.8 s | 200 |
| 2 | 8.4 s | 200 |
| 3 | **17.8 s** | 200 |
| 4 | **18.7 s** | 200 |

The client (`NewReviewDialog`) has a hard `EXTRACTION_TIMEOUT_MS = 20_000` race. Pro-tier multimodal latency is regularly bumping into that ceiling, so the toast "Auto-fill timed out — please fill the fields manually" fires even though the AI would have answered a second or two later.

In `supabase/functions/ai/index.ts` the model selection is:
```ts
const model = isMultimodal ? "google/gemini-2.5-pro" : "google/gemini-2.5-flash";
```
So `extract_project_info` (vision) gets routed to **Gemini 2.5 Pro**. Pro is the right call for full-sheet markup, but it's overkill for parsing a tiny rectangular title block — and it's the cause of the timeouts.

## Fix

Two small, surgical changes. No schema change, no new infra, no async job queue.

### 1. Route the lightweight extractions to Flash (multimodal-capable)

In `supabase/functions/ai/index.ts`, split the multimodal model choice:

```ts
// Title-block / zoning extraction → Flash (still vision-capable, ~3× faster).
// Other multimodal (full sheet review) → Pro for fidelity.
const FAST_MULTIMODAL_ACTIONS = new Set(["extract_project_info", "extract_zoning_data"]);
const model = isMultimodal
  ? (FAST_MULTIMODAL_ACTIONS.has(action) ? "google/gemini-2.5-flash" : "google/gemini-2.5-pro")
  : "google/gemini-2.5-flash";
```

Why Flash is fine here:
- The input is a single small cropped image (the title block), not a full plan sheet.
- The output is a strict JSON tool call with ~5 short string fields.
- We've already pinned `temperature = 0` for these actions, so determinism is preserved.
- The downstream pipeline (where Pro fidelity actually matters — full sheet markup, finding extraction) is unchanged.

Expected p95 latency drops from ~18s to ~5–7s.

### 2. Give the client a little more headroom

In `src/components/NewReviewDialog.tsx`, raise the timeout from 20s to 35s:

```ts
const EXTRACTION_TIMEOUT_MS = 35_000;
```

Even after the model swap, an occasional cold start or upstream hiccup can still push past 20s. 35s is comfortably under the edge function wall-clock cap and well within what users will tolerate while the visible "Reading your plans…" banner is showing. The banner copy already says "Usually 5–15 seconds" so the perceived experience doesn't change for happy-path runs; only timeouts get rarer.

## Why not async / job queue

The Lovable Stack Overflow snippet suggests a polling job pattern. We don't need it here:
- The work is sub-30 seconds, not minutes.
- The user is staring at a modal with a live progress banner — polling would add complexity and a new `autofill_jobs` table for no UX win.
- The edge function already returns synchronously and successfully; the only failure mode is the **client-side** timeout being too tight for the **model** we chose.

## Files touched

- `supabase/functions/ai/index.ts` — 4-line model-selection change.
- `src/components/NewReviewDialog.tsx` — 1-line constant change.

No migrations, no new packages, no other components affected.
