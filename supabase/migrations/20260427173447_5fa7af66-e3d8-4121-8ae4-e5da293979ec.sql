-- Immutable archive of comment letters at the moment they're sent.
CREATE TABLE public.comment_letter_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_review_id uuid NOT NULL REFERENCES public.plan_reviews(id) ON DELETE CASCADE,
  firm_id uuid,
  round integer NOT NULL DEFAULT 1,
  sent_at timestamptz NOT NULL DEFAULT now(),
  sent_by uuid NOT NULL,
  recipient text NOT NULL DEFAULT '',
  letter_html text NOT NULL DEFAULT '',
  findings_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  firm_info_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  readiness_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  override_reasons text,
  pdf_storage_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_letter_snapshots_review ON public.comment_letter_snapshots(plan_review_id, round DESC);
CREATE INDEX idx_letter_snapshots_firm ON public.comment_letter_snapshots(firm_id);

ALTER TABLE public.comment_letter_snapshots ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER set_firm_id_on_letter_snapshot
  BEFORE INSERT ON public.comment_letter_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.set_firm_id_from_plan_review();

CREATE POLICY "Firm members read letter snapshots"
  ON public.comment_letter_snapshots FOR SELECT TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Firm members insert letter snapshots"
  ON public.comment_letter_snapshots FOR INSERT TO authenticated
  WITH CHECK (sent_by = auth.uid() AND (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid())));

CREATE POLICY "Admins delete letter snapshots"
  ON public.comment_letter_snapshots FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));
