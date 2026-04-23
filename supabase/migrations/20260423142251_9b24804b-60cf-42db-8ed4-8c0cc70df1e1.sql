CREATE INDEX IF NOT EXISTS idx_pipeline_active
ON public.review_pipeline_status (firm_id, updated_at DESC)
WHERE status IN ('running', 'pending');