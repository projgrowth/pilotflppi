ALTER TABLE public.plan_reviews
  ADD COLUMN IF NOT EXISTS pipeline_version text NOT NULL DEFAULT 'v2';