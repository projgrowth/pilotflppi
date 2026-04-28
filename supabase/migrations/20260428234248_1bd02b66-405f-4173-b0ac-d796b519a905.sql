ALTER TABLE public.deficiencies_v2
  ADD COLUMN IF NOT EXISTS verification_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.pipeline_quality_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_review_id uuid NOT NULL REFERENCES public.plan_reviews(id) ON DELETE CASCADE,
  firm_id uuid,
  ai_check_status text NOT NULL,
  quality_score integer NOT NULL DEFAULT 0,
  unverified_pct integer NOT NULL DEFAULT 0,
  hallucinated_count integer NOT NULL DEFAULT 0,
  total_live_findings integer NOT NULL DEFAULT 0,
  blocker_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pqe_firm_created
  ON public.pipeline_quality_events (firm_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pqe_review_created
  ON public.pipeline_quality_events (plan_review_id, created_at DESC);

ALTER TABLE public.pipeline_quality_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view their firm's quality events"
  ON public.pipeline_quality_events;
CREATE POLICY "Members can view their firm's quality events"
  ON public.pipeline_quality_events
  FOR SELECT
  TO authenticated
  USING (firm_id = public.user_firm_id(auth.uid()));

DROP TRIGGER IF EXISTS set_firm_id_pipeline_quality_events
  ON public.pipeline_quality_events;
CREATE TRIGGER set_firm_id_pipeline_quality_events
  BEFORE INSERT ON public.pipeline_quality_events
  FOR EACH ROW
  EXECUTE FUNCTION public.set_firm_id_from_plan_review();