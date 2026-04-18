ALTER TABLE public.plan_reviews
ADD COLUMN IF NOT EXISTS ai_run_progress jsonb DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.plan_reviews.ai_run_progress IS 'Tracks AI review pipeline phase + counts so a reviewer can resume after tab close. Shape: { phase, current, total, updated_at }';