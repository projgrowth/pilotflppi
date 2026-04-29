-- Provenance columns on canonical FBC sections
ALTER TABLE public.fbc_code_sections
  ADD COLUMN IF NOT EXISTS seed_source text NOT NULL DEFAULT 'unseeded',
  ADD COLUMN IF NOT EXISTS seed_confidence numeric;

ALTER TABLE public.fbc_code_sections
  DROP CONSTRAINT IF EXISTS fbc_code_sections_seed_source_chk;
ALTER TABLE public.fbc_code_sections
  ADD CONSTRAINT fbc_code_sections_seed_source_chk
  CHECK (seed_source IN ('unseeded','ai_drafted','human_verified','imported'));

-- Backfill: classify existing rows.
UPDATE public.fbc_code_sections
SET seed_source = CASE
  WHEN requirement_text IS NULL
       OR length(requirement_text) < 60
       OR lower(requirement_text) LIKE '%see fbc for full requirement text%'
    THEN 'unseeded'
  ELSE 'imported'
END
WHERE seed_source = 'unseeded' OR seed_source = 'imported';

CREATE INDEX IF NOT EXISTS fbc_code_sections_seed_source_idx
  ON public.fbc_code_sections (seed_source);

-- Audit table: every auto-rewrite of a citation by ground_citations
CREATE TABLE IF NOT EXISTS public.citation_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deficiency_id uuid NOT NULL,
  plan_review_id uuid NOT NULL,
  firm_id uuid,
  original_section text,
  suggested_section text NOT NULL,
  similarity_score numeric NOT NULL,
  applied boolean NOT NULL DEFAULT false,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS citation_corrections_deficiency_idx
  ON public.citation_corrections (deficiency_id);
CREATE INDEX IF NOT EXISTS citation_corrections_review_idx
  ON public.citation_corrections (plan_review_id);

ALTER TABLE public.citation_corrections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Firm members read citation_corrections" ON public.citation_corrections;
CREATE POLICY "Firm members read citation_corrections"
  ON public.citation_corrections
  FOR SELECT
  TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role));

-- No INSERT policy: only the service role (edge functions) writes here.
-- This prevents reviewers from manually rewriting the audit trail.