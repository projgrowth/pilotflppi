
-- Add persistent finding statuses (keyed by finding index)
ALTER TABLE public.plan_reviews
ADD COLUMN IF NOT EXISTS finding_statuses jsonb DEFAULT '{}'::jsonb;

-- Add previous round findings for diff comparison
ALTER TABLE public.plan_reviews
ADD COLUMN IF NOT EXISTS previous_findings jsonb DEFAULT '[]'::jsonb;
