
-- Required inspections matrix
CREATE TABLE public.required_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  firm_id uuid,
  inspection_type text NOT NULL,
  code_basis text NOT NULL DEFAULT 'FBC 110',
  is_threshold_inspection boolean NOT NULL DEFAULT false,
  trade text NOT NULL DEFAULT 'building',
  status text NOT NULL DEFAULT 'not_started',
  scheduled_for timestamptz,
  completed_at timestamptz,
  inspector_id uuid,
  result text,
  report_id uuid,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT required_inspections_status_chk CHECK (status IN ('not_started','scheduled','in_progress','passed','failed','partial','na','waived')),
  CONSTRAINT required_inspections_result_chk CHECK (result IS NULL OR result IN ('pass','fail','partial','na'))
);
CREATE INDEX idx_required_inspections_project ON public.required_inspections(project_id);
CREATE INDEX idx_required_inspections_firm ON public.required_inspections(firm_id);

ALTER TABLE public.required_inspections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Firm members read required_inspections"
  ON public.required_inspections FOR SELECT TO authenticated
  USING (firm_id IS NULL OR firm_id = user_firm_id(auth.uid()) OR has_role(auth.uid(),'admin'));
CREATE POLICY "Firm members insert required_inspections"
  ON public.required_inspections FOR INSERT TO authenticated
  WITH CHECK (firm_id IS NULL OR firm_id = user_firm_id(auth.uid()));
CREATE POLICY "Firm members update required_inspections"
  ON public.required_inspections FOR UPDATE TO authenticated
  USING (firm_id IS NULL OR firm_id = user_firm_id(auth.uid()) OR has_role(auth.uid(),'admin'));
CREATE POLICY "Admins delete required_inspections"
  ON public.required_inspections FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_required_inspections_firm
  BEFORE INSERT ON public.required_inspections
  FOR EACH ROW EXECUTE FUNCTION public.set_firm_id_from_user();
CREATE TRIGGER trg_required_inspections_updated
  BEFORE UPDATE ON public.required_inspections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Inspection report snapshots
CREATE TABLE public.inspection_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  required_inspection_id uuid REFERENCES public.required_inspections(id) ON DELETE SET NULL,
  firm_id uuid,
  inspector_id uuid,
  inspector_name text NOT NULL DEFAULT '',
  inspector_license text NOT NULL DEFAULT '',
  inspection_type text NOT NULL,
  performed_at timestamptz NOT NULL DEFAULT now(),
  result text NOT NULL DEFAULT 'pass',
  narrative text NOT NULL DEFAULT '',
  deficiencies jsonb NOT NULL DEFAULT '[]'::jsonb,
  photo_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  report_html text NOT NULL DEFAULT '',
  report_html_sha256 text,
  pdf_storage_path text,
  pdf_sha256 text,
  sent_to_ahj_at timestamptz,
  ahj_recipient text,
  readiness_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inspection_reports_result_chk CHECK (result IN ('pass','fail','partial','na'))
);
CREATE INDEX idx_inspection_reports_project ON public.inspection_reports(project_id);
CREATE INDEX idx_inspection_reports_required ON public.inspection_reports(required_inspection_id);
CREATE INDEX idx_inspection_reports_firm ON public.inspection_reports(firm_id);

ALTER TABLE public.inspection_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Firm members read inspection_reports"
  ON public.inspection_reports FOR SELECT TO authenticated
  USING (firm_id IS NULL OR firm_id = user_firm_id(auth.uid()) OR has_role(auth.uid(),'admin'));
CREATE POLICY "Firm members insert inspection_reports"
  ON public.inspection_reports FOR INSERT TO authenticated
  WITH CHECK (firm_id IS NULL OR firm_id = user_firm_id(auth.uid()));
CREATE POLICY "Firm members update inspection_reports"
  ON public.inspection_reports FOR UPDATE TO authenticated
  USING (firm_id IS NULL OR firm_id = user_firm_id(auth.uid()) OR has_role(auth.uid(),'admin'));
CREATE POLICY "Admins delete inspection_reports"
  ON public.inspection_reports FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_inspection_reports_firm
  BEFORE INSERT ON public.inspection_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_firm_id_from_user();
CREATE TRIGGER trg_inspection_reports_updated
  BEFORE UPDATE ON public.inspection_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Inspection photo chain-of-custody
CREATE TABLE public.inspection_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_report_id uuid REFERENCES public.inspection_reports(id) ON DELETE CASCADE,
  required_inspection_id uuid REFERENCES public.required_inspections(id) ON DELETE SET NULL,
  project_id uuid NOT NULL,
  firm_id uuid,
  storage_path text NOT NULL,
  sha256 text NOT NULL,
  captured_at timestamptz,
  gps_lat numeric,
  gps_lng numeric,
  uploaded_by uuid,
  deficiency_ref text,
  caption text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_inspection_photos_report ON public.inspection_photos(inspection_report_id);
CREATE INDEX idx_inspection_photos_project ON public.inspection_photos(project_id);
CREATE INDEX idx_inspection_photos_firm ON public.inspection_photos(firm_id);

ALTER TABLE public.inspection_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Firm members read inspection_photos"
  ON public.inspection_photos FOR SELECT TO authenticated
  USING (firm_id IS NULL OR firm_id = user_firm_id(auth.uid()) OR has_role(auth.uid(),'admin'));
CREATE POLICY "Firm members insert inspection_photos"
  ON public.inspection_photos FOR INSERT TO authenticated
  WITH CHECK ((uploaded_by IS NULL OR uploaded_by = auth.uid()) AND (firm_id IS NULL OR firm_id = user_firm_id(auth.uid())));
CREATE POLICY "Admins delete inspection_photos"
  ON public.inspection_photos FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_inspection_photos_firm
  BEFORE INSERT ON public.inspection_photos
  FOR EACH ROW EXECUTE FUNCTION public.set_firm_id_from_user();

-- Certificate of Compliance (F.S. 553.791(10))
CREATE TABLE public.certificates_of_compliance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  firm_id uuid,
  issued_at timestamptz NOT NULL DEFAULT now(),
  issued_by uuid NOT NULL,
  attestor_name text NOT NULL,
  attestor_license text NOT NULL,
  attestation_text text NOT NULL,
  included_report_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  chained_hash text NOT NULL,
  certificate_html text NOT NULL DEFAULT '',
  certificate_html_sha256 text,
  pdf_storage_path text,
  pdf_sha256 text,
  ahj_recipient text,
  sent_to_ahj_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_coc_project ON public.certificates_of_compliance(project_id);
CREATE INDEX idx_coc_firm ON public.certificates_of_compliance(firm_id);

ALTER TABLE public.certificates_of_compliance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Firm members read coc"
  ON public.certificates_of_compliance FOR SELECT TO authenticated
  USING (firm_id IS NULL OR firm_id = user_firm_id(auth.uid()) OR has_role(auth.uid(),'admin'));
CREATE POLICY "Firm members insert coc"
  ON public.certificates_of_compliance FOR INSERT TO authenticated
  WITH CHECK (issued_by = auth.uid() AND (firm_id IS NULL OR firm_id = user_firm_id(auth.uid())));
CREATE POLICY "Firm members update coc revoke"
  ON public.certificates_of_compliance FOR UPDATE TO authenticated
  USING (firm_id IS NULL OR firm_id = user_firm_id(auth.uid()) OR has_role(auth.uid(),'admin'));
CREATE POLICY "Admins delete coc"
  ON public.certificates_of_compliance FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_coc_firm
  BEFORE INSERT ON public.certificates_of_compliance
  FOR EACH ROW EXECUTE FUNCTION public.set_firm_id_from_user();
