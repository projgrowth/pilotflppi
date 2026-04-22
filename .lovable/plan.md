

## Why "Proper Pizza & Pasta" Pipeline Says No Findings

### Root cause

The pipeline isn't failing at the findings stage — it's failing at **stage 1 (`upload`)** before any AI ever runs. Edge function logs show three retries all returning:

> `Error: No files uploaded for this plan review`

The frontend toast says "Pipeline run complete" because of how the success callback is wired, but every stage afterward is skipped.

### Why the upload stage thinks there are no files

Two tables track uploaded PDFs and they're out of sync for this review:

| Table | What's there for `eb8df5a0-…` |
|---|---|
| `plan_reviews.file_urls` | `["plan-reviews/eb8df5a0-…/Document2.pdf"]` ✅ |
| `plan_review_files` (rows) | **0 rows** ❌ |

`run-review-pipeline/index.ts → stageUpload()` queries `plan_review_files` (line 347). With zero rows it throws.

The bug is in `src/components/NewPlanReviewWizard.tsx`: when a plan review is created from the wizard, file paths get written to `plan_reviews.file_urls` (line 333) but **no matching rows are ever inserted into `plan_review_files`**. By contrast `src/pages/PlanReviewDetail.tsx` (line 174) does insert into `plan_review_files` when files are added later — that's why older reviews work.

### Fix (3 small changes)

**1. `src/components/NewPlanReviewWizard.tsx`** — after uploading PDFs and updating `file_urls`, also insert one row per file into `plan_review_files`:

```ts
await supabase.from("plan_review_files").insert(
  fileUrls.map((fp) => ({
    plan_review_id: review.id,
    file_path: fp,
    round: 1,
    uploaded_by: userId,    // already known in this scope
    firm_id: firmId,        // already known in this scope
  }))
);
```

**2. Backfill the orphaned record** — one-line migration to repair Proper Pizza & Pasta (and any other reviews stuck in the same state) by inserting `plan_review_files` rows from `plan_reviews.file_urls` where they're missing:

```sql
INSERT INTO plan_review_files (plan_review_id, file_path, round, firm_id)
SELECT pr.id, unnest(pr.file_urls), pr.round, pr.firm_id
FROM plan_reviews pr
WHERE pr.file_urls IS NOT NULL
  AND array_length(pr.file_urls, 1) > 0
  AND NOT EXISTS (
    SELECT 1 FROM plan_review_files prf WHERE prf.plan_review_id = pr.id
  );
```

**3. `src/pages/ReviewDashboard.tsx`** — the "Run Pipeline" success toast fires even when the pipeline returns errors per-stage. Change `runPipeline()` to inspect the response payload and show `toast.error` if any stage status is `error`, so failures stop being silently labeled "complete."

### After the fix
Re-run the pipeline on Proper Pizza & Pasta. Stages should advance past `upload` and the dashboard will populate with deficiencies.

### Files touched
- Edit: `src/components/NewPlanReviewWizard.tsx` (insert into `plan_review_files`)
- Edit: `src/pages/ReviewDashboard.tsx` (honest pipeline result toast)
- New: `supabase/migrations/<ts>_backfill_plan_review_files.sql`

