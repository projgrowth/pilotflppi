ALTER TABLE public.plan_reviews
  ADD COLUMN IF NOT EXISTS pipeline_version text NOT NULL DEFAULT 'v1';

CREATE INDEX IF NOT EXISTS idx_plan_reviews_pipeline_version
  ON public.plan_reviews (pipeline_version);

COMMENT ON COLUMN public.plan_reviews.pipeline_version IS
  'v1 = legacy ai_findings JSONB on this row; v2 = deficiencies_v2 table is the source of truth for this review.';