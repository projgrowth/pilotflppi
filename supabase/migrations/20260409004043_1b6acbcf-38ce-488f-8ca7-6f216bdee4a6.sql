
-- Add QC columns to plan_reviews
ALTER TABLE public.plan_reviews
  ADD COLUMN IF NOT EXISTS qc_status TEXT NOT NULL DEFAULT 'pending_qc',
  ADD COLUMN IF NOT EXISTS qc_reviewer_id UUID DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS qc_notes TEXT DEFAULT '';
