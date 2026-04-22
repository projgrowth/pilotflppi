-- Drop the legacy v1 ai_findings JSONB column from plan_reviews.
-- All readers now use deficiencies_v2 (the v2 pipeline source of truth).
ALTER TABLE public.plan_reviews DROP COLUMN IF EXISTS ai_findings;