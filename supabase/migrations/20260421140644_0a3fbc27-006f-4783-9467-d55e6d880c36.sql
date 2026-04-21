-- Reviewer Memory: capture structured rejection reasons and convert
-- them into firm-specific patterns that prime future AI reviews.

CREATE TABLE IF NOT EXISTS public.correction_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid,
  discipline text NOT NULL,
  pattern_summary text NOT NULL,            -- short, prompt-friendly summary
  original_finding text NOT NULL,
  original_required_action text NOT NULL DEFAULT '',
  code_reference jsonb DEFAULT '{}'::jsonb,
  rejection_reason text NOT NULL,           -- enum-ish, see below
  reason_notes text NOT NULL DEFAULT '',
  -- Project DNA snapshot at time of rejection (for matching)
  occupancy_classification text,
  construction_type text,
  county text,
  fbc_edition text,
  -- Aggregation
  rejection_count integer NOT NULL DEFAULT 1,
  confirm_count integer NOT NULL DEFAULT 0, -- inverse signal
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,  -- reviewers can "un-learn"
  source_deficiency_id uuid,                -- first deficiency that produced it
  source_plan_review_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_correction_patterns_firm_active
  ON public.correction_patterns (firm_id, is_active);
CREATE INDEX IF NOT EXISTS idx_correction_patterns_discipline
  ON public.correction_patterns (discipline);

ALTER TABLE public.correction_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Firm members read correction_patterns"
  ON public.correction_patterns FOR SELECT TO authenticated
  USING ((firm_id IS NULL) OR (firm_id = user_firm_id(auth.uid())) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Firm members insert correction_patterns"
  ON public.correction_patterns FOR INSERT TO authenticated
  WITH CHECK ((firm_id IS NULL) OR (firm_id = user_firm_id(auth.uid())));

CREATE POLICY "Firm members update correction_patterns"
  ON public.correction_patterns FOR UPDATE TO authenticated
  USING ((firm_id IS NULL) OR (firm_id = user_firm_id(auth.uid())) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Firm members delete correction_patterns"
  ON public.correction_patterns FOR DELETE TO authenticated
  USING ((firm_id IS NULL) OR (firm_id = user_firm_id(auth.uid())) OR has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_correction_patterns_updated_at
  BEFORE UPDATE ON public.correction_patterns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_correction_patterns_firm_id
  BEFORE INSERT ON public.correction_patterns
  FOR EACH ROW EXECUTE FUNCTION public.set_firm_id_from_user();

-- Track which patterns were applied to each review so reviewers can audit
CREATE TABLE IF NOT EXISTS public.applied_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid,
  plan_review_id uuid NOT NULL,
  pattern_id uuid NOT NULL REFERENCES public.correction_patterns(id) ON DELETE CASCADE,
  discipline text NOT NULL,
  pattern_summary text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_applied_corrections_review
  ON public.applied_corrections (plan_review_id);

ALTER TABLE public.applied_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Firm members read applied_corrections"
  ON public.applied_corrections FOR SELECT TO authenticated
  USING ((firm_id IS NULL) OR (firm_id = user_firm_id(auth.uid())) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Firm members insert applied_corrections"
  ON public.applied_corrections FOR INSERT TO authenticated
  WITH CHECK ((firm_id IS NULL) OR (firm_id = user_firm_id(auth.uid())));

CREATE TRIGGER set_applied_corrections_firm_id
  BEFORE INSERT ON public.applied_corrections
  FOR EACH ROW EXECUTE FUNCTION public.set_firm_id_from_user();