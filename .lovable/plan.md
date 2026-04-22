
## Raise PDF Upload Limit to 50 MB

The 20 MB cap is enforced in three places. All three need to change for 50 MB to actually work end-to-end.

### What changes

**1. Storage bucket limit (server-side, hard cap)**
The `documents` bucket in Lovable Cloud currently rejects anything over 20 MB before the file even reaches your code. New migration to raise it:

```sql
UPDATE storage.buckets
SET file_size_limit = 52428800   -- 50 MB in bytes
WHERE id = 'documents';
```

**2. Client-side validation (`src/components/NewPlanReviewWizard.tsx`, line ~169)**
```ts
if (file.size > 50 * 1024 * 1024) {
  toast.error(`${file.name} exceeds 50MB limit`);
  continue;
}
```
And the helper text on line ~436: `"PDF files up to 50MB each • Header validation enabled"`.

**3. Drop-zone helper text (`src/components/plan-review/PlanViewerPanel.tsx`, line 62)**
`"PDF files up to 50MB"`.

### Caveats worth knowing before you approve

- **PDF.js render memory** — 50 MB plans (often 100+ pages, large rasters) can spike browser memory hard during page rendering. If you're hitting OOM crashes after this change, the next step is rendering pages on-demand instead of all upfront.
- **Gemini vision pipeline** — `run-review-pipeline` sends page images to the AI gateway. Larger documents = more pages = longer pipeline runs and higher token costs. No code change needed, just a heads-up.
- **Edge function payload limit** — Supabase edge functions have a 6 MB request body limit, but you upload directly to Storage (not through a function), so this is fine.

### If you want a different number

Say "make it 100 MB" or "make it 200 MB" and I'll swap the values. The byte math: `MB × 1024 × 1024`. For 100 MB → `104857600`. For 200 MB → `209715200`.

### Files touched
- New: `supabase/migrations/<timestamp>_raise_documents_bucket_limit.sql`
- Edit: `src/components/NewPlanReviewWizard.tsx` (2 lines)
- Edit: `src/components/plan-review/PlanViewerPanel.tsx` (1 line)
