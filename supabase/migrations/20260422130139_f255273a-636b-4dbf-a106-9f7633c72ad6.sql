-- Step 1: flip all remaining v1 reviews to v2 (backfill of findings already done via insert tool).
UPDATE public.plan_reviews
SET pipeline_version = 'v2', updated_at = now()
WHERE pipeline_version = 'v1';

-- Step 2: drop the column entirely — the schema now reflects "only v2 exists".
ALTER TABLE public.plan_reviews DROP COLUMN pipeline_version;