-- 1. CHECK constraint on ai_check_status
-- First, normalize any unknown values
UPDATE public.plan_reviews
SET ai_check_status = 'failed',
    ai_run_progress = COALESCE(ai_run_progress, '{}'::jsonb) || jsonb_build_object('failure_reason', 'Legacy error state — reset by maintenance', 'reset_at', now()::text)
WHERE ai_check_status NOT IN ('pending','running','complete','failed','needs_user_action','needs_human_review');

ALTER TABLE public.plan_reviews
  ADD CONSTRAINT plan_reviews_ai_check_status_check
  CHECK (ai_check_status IN ('pending','running','complete','failed','needs_user_action','needs_human_review'));

-- 2. Stage checkpoints column for resumable retries
ALTER TABLE public.plan_reviews
  ADD COLUMN IF NOT EXISTS stage_checkpoints jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 3. Index for pipeline_error_log dashboard queries
CREATE INDEX IF NOT EXISTS pipeline_error_log_review_created_idx
  ON public.pipeline_error_log (plan_review_id, created_at DESC);

-- 4. Trigger to auto-fill firm_id from parent plan_review
CREATE OR REPLACE FUNCTION public.set_firm_id_from_plan_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.firm_id IS NULL AND NEW.plan_review_id IS NOT NULL THEN
    SELECT firm_id INTO NEW.firm_id
    FROM public.plan_reviews
    WHERE id = NEW.plan_review_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_firm_id_from_plan_review_trg ON public.pipeline_error_log;
CREATE TRIGGER set_firm_id_from_plan_review_trg
  BEFORE INSERT ON public.pipeline_error_log
  FOR EACH ROW EXECUTE FUNCTION public.set_firm_id_from_plan_review();

DROP TRIGGER IF EXISTS set_firm_id_from_plan_review_trg ON public.plan_review_page_assets;
CREATE TRIGGER set_firm_id_from_plan_review_trg
  BEFORE INSERT ON public.plan_review_page_assets
  FOR EACH ROW EXECUTE FUNCTION public.set_firm_id_from_plan_review();

-- 5. Backfill firm_id NULLs in pipeline_error_log
UPDATE public.pipeline_error_log el
SET firm_id = pr.firm_id
FROM public.plan_reviews pr
WHERE el.plan_review_id = pr.id
  AND el.firm_id IS NULL
  AND pr.firm_id IS NOT NULL;

UPDATE public.plan_review_page_assets pa
SET firm_id = pr.firm_id
FROM public.plan_reviews pr
WHERE pa.plan_review_id = pr.id
  AND pa.firm_id IS NULL
  AND pr.firm_id IS NOT NULL;

-- 6. Allow service role to insert into pipeline_error_log (edge functions)
CREATE POLICY "Service role insert pipeline_error_log"
  ON public.pipeline_error_log
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- 7. Allow service role to delete pipeline_error_log (retention cron)
CREATE POLICY "Service role delete pipeline_error_log"
  ON public.pipeline_error_log
  FOR DELETE
  TO service_role
  USING (true);