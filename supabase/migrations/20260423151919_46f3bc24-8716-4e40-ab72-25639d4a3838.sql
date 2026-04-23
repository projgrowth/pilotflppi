-- 1. Cache + vision-asset cols on the page manifest
ALTER TABLE public.plan_review_page_assets
  ADD COLUMN IF NOT EXISTS vision_storage_path text,
  ADD COLUMN IF NOT EXISTS cached_signed_url text,
  ADD COLUMN IF NOT EXISTS cached_until timestamptz;

-- 2. Per-review coverage row written at end of discipline_review
CREATE TABLE IF NOT EXISTS public.review_coverage (
  plan_review_id uuid PRIMARY KEY REFERENCES public.plan_reviews(id) ON DELETE CASCADE,
  firm_id uuid,
  sheets_total int NOT NULL DEFAULT 0,
  sheets_reviewed int NOT NULL DEFAULT 0,
  by_discipline jsonb NOT NULL DEFAULT '{}'::jsonb,
  capped_at int,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.review_coverage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Firm members read review_coverage" ON public.review_coverage;
CREATE POLICY "Firm members read review_coverage"
  ON public.review_coverage FOR SELECT TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Firm members insert review_coverage" ON public.review_coverage;
CREATE POLICY "Firm members insert review_coverage"
  ON public.review_coverage FOR INSERT TO authenticated
  WITH CHECK (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()));

DROP POLICY IF EXISTS "Firm members update review_coverage" ON public.review_coverage;
CREATE POLICY "Firm members update review_coverage"
  ON public.review_coverage FOR UPDATE TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE INDEX IF NOT EXISTS idx_review_coverage_firm ON public.review_coverage(firm_id);