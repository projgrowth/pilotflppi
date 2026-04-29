# Fix: "Object not found" on the HIGEL plan-review

## What's actually broken

Your latest plan-review (`c5a71ae7…`) shows two errors:

1. **"Files are uploaded but pages haven't been rasterized"** — accurate. The DB has 1 file row but 0 page assets. The "Prepare pages now" button should fix it, but…
2. **"…01-06-2025 (1) Compressed.pdf: Object not found"** — re-prepare itself fails, so the rasterization never runs.

### Root cause

The file row's `file_path` was saved as a **full public URL**:

```
https://iisgxjneamwbehipgcmg.supabase.co/storage/v1/object/public/documents/plan-reviews/c5a71ae7…/4644%20HIGEL%20AV%20-%2001-06-2025%20(1)%20Compressed.pdf
```

But every code path (re-prepare, the pipeline's `prepare-pages` stage, evidence cropping) expects a **storage key** like:

```
plan-reviews/c5a71ae7…/round-1/4644 HIGEL AV - 01-06-2025 (1) Compressed.pdf
```

When `supabase.storage.from("documents").createSignedUrl(<full URL>, …)` is called, Storage URL-encodes it again and looks for a literal object named `https%3A%2F%2F…%2F4644%2520HIGEL%2520AV…` — which obviously doesn't exist → "Object not found". The same row shows up twice in the panel because both the verify-stage probe and the dashboard's findings query each report it.

A scan of the database confirms only **2 rows project-wide** have URL-style paths (both on this HIGEL project, created by an older upload path). Every other review uses correct keys. This is also why **"the projects I deleted came back" feels related** — those four HIGEL reviews with 0 page-assets are stuck in this same broken state and can't progress.

## Fix plan (Wave A2 — small, surgical)

### 1. Defensive normalization (prevents recurrence)

Add a tiny helper `normalizeStorageKey(input: string): string` in `src/lib/storage-paths.ts` that:
- If input starts with `https://…/storage/v1/object/(public|sign)/documents/`, strips the prefix and `decodeURIComponent`s the rest.
- Otherwise returns input unchanged.

Use it everywhere we feed `plan_review_files.file_path` into Storage calls:
- `src/lib/reprepare-in-browser.ts` (`downloadAndValidate`)
- `src/lib/delete-plan-review.ts` and `delete-plan-review-file.ts`
- `src/hooks/useEvidenceCrop.ts`
- `supabase/functions/run-review-pipeline/_shared/storage.ts` (mirror it in Deno)

Net effect: even if a future code path ever writes a URL again, the system silently does the right thing instead of throwing "Object not found".

### 2. One-time data backfill (unblocks the user right now)

A single migration that, for the 2 affected rows:
- Strips the `https://…/object/public/documents/` prefix from `file_path`.
- `decodeURIComponent`s spaces/parens.
- Verifies the resulting key starts with `plan-reviews/`.

After this runs, the user can click **"Prepare pages now"** on the HIGEL review and the existing rasterizer will work.

### 3. Log a one-line warning when normalization fires

So we notice if anything starts writing URL-style paths again. A `console.warn("[plan-review] normalized URL-style file_path → key")` in the helper is enough — no UI surface needed.

## What this does NOT do

- Does not block on Wave B (statutory clock, CoC gating, firm_id hardening) — that plan still stands.
- Does not change the upload writer (`plan-review-upload.ts`) because it already writes correct keys; the bad rows came from an older code path that's no longer in the tree.
- Does not touch the rasterization pipeline itself — once the path is right, the existing "Prepare pages now" button completes the flow.

## Files touched

- new: `src/lib/storage-paths.ts`
- edited: `src/lib/reprepare-in-browser.ts`, `src/lib/delete-plan-review.ts`, `src/lib/delete-plan-review-file.ts`, `src/hooks/useEvidenceCrop.ts`
- edited: `supabase/functions/run-review-pipeline/_shared/storage.ts`
- new migration: backfill 2 `plan_review_files` rows

Approve and I'll ship Wave A2, then we can return to Wave B (statutory correctness).