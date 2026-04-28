
-- 1. beta_feedback table for in-app bug reports during beta
CREATE TABLE public.beta_feedback (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  firm_id uuid,
  plan_review_id uuid,
  project_id uuid,
  category text NOT NULL DEFAULT 'general',
  severity text NOT NULL DEFAULT 'normal',
  message text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT beta_feedback_severity_check CHECK (severity IN ('low','normal','high','blocker')),
  CONSTRAINT beta_feedback_category_check CHECK (category IN ('general','bug','ai_quality','ux','performance','data','feature_request')),
  CONSTRAINT beta_feedback_status_check CHECK (status IN ('open','triaged','resolved','wontfix'))
);

ALTER TABLE public.beta_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Firm members insert beta_feedback"
  ON public.beta_feedback FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid())));

CREATE POLICY "Firm members read beta_feedback"
  ON public.beta_feedback FOR SELECT TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'::app_role));

CREATE POLICY "Admins update beta_feedback"
  ON public.beta_feedback FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role));

CREATE POLICY "Admins delete beta_feedback"
  ON public.beta_feedback FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role));

CREATE TRIGGER tr_set_firm_id_beta_feedback
  BEFORE INSERT ON public.beta_feedback
  FOR EACH ROW EXECUTE FUNCTION public.set_firm_id_from_user();

CREATE TRIGGER tr_beta_feedback_updated
  BEFORE UPDATE ON public.beta_feedback
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_beta_feedback_firm_created ON public.beta_feedback (firm_id, created_at DESC);
CREATE INDEX idx_beta_feedback_status ON public.beta_feedback (status) WHERE status = 'open';

-- 2. Indexes for pipeline health & citation gating
CREATE INDEX IF NOT EXISTS idx_pipeline_error_log_review_created
  ON public.pipeline_error_log (plan_review_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_deficiencies_v2_review_citation
  ON public.deficiencies_v2 (plan_review_id, citation_status);

-- 3. Lock down trigger-only SECURITY DEFINER helpers (linter warnings 4-10).
--    These should never be invoked through PostgREST.
REVOKE EXECUTE ON FUNCTION public.set_firm_id_from_user() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.set_firm_id_from_plan_review() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.auto_advance_project_status() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.auto_manage_statutory_clock() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.log_clock_state_changes() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.reset_review_clock_on_resubmission() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.set_inspection_clock_on_schedule() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.protect_letter_snapshot_immutable() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.compute_letter_snapshot_chained_hash() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.flag_findings_for_reground_on_canonical_change() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.clear_fbc_embedding_on_text_change() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;

-- check_deadline_alerts is called by pg_cron only; lock it down too.
REVOKE EXECUTE ON FUNCTION public.check_deadline_alerts() FROM anon, authenticated, public;
