-- 1) Dedupe any existing collisions in plan_review_page_assets so the
--    unique index can be created safely. Keep the earliest row (smallest
--    created_at, smallest id as tiebreaker) for each (plan_review_id, page_index).
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY plan_review_id, page_index
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.plan_review_page_assets
)
DELETE FROM public.plan_review_page_assets a
USING ranked r
WHERE a.id = r.id
  AND r.rn > 1;

-- 2) Now safe to enforce uniqueness. Lets the gap-only re-rasterize path
--    INSERT (instead of delete-then-insert) and prevents duplicate rows
--    when a worker retries.
CREATE UNIQUE INDEX IF NOT EXISTS plan_review_page_assets_review_page_uniq
  ON public.plan_review_page_assets (plan_review_id, page_index);