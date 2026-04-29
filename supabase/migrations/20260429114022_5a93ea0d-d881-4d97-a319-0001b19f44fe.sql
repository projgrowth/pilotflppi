CREATE OR REPLACE FUNCTION public.merge_review_progress(
  _plan_review_id uuid,
  _patch jsonb
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.plan_reviews
     SET ai_run_progress = COALESCE(ai_run_progress, '{}'::jsonb) || COALESCE(_patch, '{}'::jsonb),
         updated_at      = now()
   WHERE id = _plan_review_id;
$$;

COMMENT ON FUNCTION public.merge_review_progress(uuid, jsonb) IS
  'Atomically merge a JSONB patch into plan_reviews.ai_run_progress. Use instead of read-modify-write from edge functions to prevent lost updates when multiple stages run concurrently.';