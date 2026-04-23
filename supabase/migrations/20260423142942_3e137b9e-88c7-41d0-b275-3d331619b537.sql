
CREATE TABLE IF NOT EXISTS public.pipeline_error_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_review_id uuid NOT NULL REFERENCES public.plan_reviews(id) ON DELETE CASCADE,
  firm_id uuid,
  stage text NOT NULL,
  error_class text NOT NULL DEFAULT 'unknown',
  error_message text NOT NULL DEFAULT '',
  attempt_count integer NOT NULL DEFAULT 1,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_error_log_firm_recent
  ON public.pipeline_error_log (firm_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pipeline_error_log_review
  ON public.pipeline_error_log (plan_review_id, created_at DESC);

ALTER TABLE public.pipeline_error_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Firm members read pipeline_error_log"
  ON public.pipeline_error_log FOR SELECT
  TO authenticated
  USING ((firm_id IS NULL) OR (firm_id = public.user_firm_id(auth.uid())) OR public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Firm members insert pipeline_error_log"
  ON public.pipeline_error_log FOR INSERT
  TO authenticated
  WITH CHECK ((firm_id IS NULL) OR (firm_id = public.user_firm_id(auth.uid())));
