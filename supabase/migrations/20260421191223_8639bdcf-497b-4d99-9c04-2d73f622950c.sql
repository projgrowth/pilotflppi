-- Canonical FBC code sections: source of truth for citation verification.
CREATE TABLE public.fbc_code_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition text NOT NULL DEFAULT '8th',
  code text NOT NULL DEFAULT 'FBC',
  section text NOT NULL,
  title text NOT NULL,
  requirement_text text NOT NULL,
  keywords text[] NOT NULL DEFAULT '{}',
  source_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Lookups are always (code, section, edition); make that fast and unique.
CREATE UNIQUE INDEX fbc_code_sections_canonical_idx
  ON public.fbc_code_sections (code, section, edition);

-- Section-only lookup is also common (when the AI omits the edition).
CREATE INDEX fbc_code_sections_section_idx
  ON public.fbc_code_sections (section);

ALTER TABLE public.fbc_code_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All authenticated read fbc_code_sections"
  ON public.fbc_code_sections FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins insert fbc_code_sections"
  ON public.fbc_code_sections FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins update fbc_code_sections"
  ON public.fbc_code_sections FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins delete fbc_code_sections"
  ON public.fbc_code_sections FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER fbc_code_sections_updated_at
  BEFORE UPDATE ON public.fbc_code_sections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Citation verification fields on deficiencies_v2.
ALTER TABLE public.deficiencies_v2
  ADD COLUMN citation_status text NOT NULL DEFAULT 'unverified',
  ADD COLUMN citation_match_score numeric,
  ADD COLUMN citation_canonical_text text,
  ADD COLUMN citation_grounded_at timestamptz;

-- Cheap lookup for the dashboard "show me the unverifiable findings" view.
CREATE INDEX deficiencies_v2_citation_status_idx
  ON public.deficiencies_v2 (plan_review_id, citation_status);
