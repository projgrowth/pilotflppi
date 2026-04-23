-- Page asset manifest: cached registry of rasterized PDF pages so the
-- pipeline can avoid re-listing storage and re-rasterizing PDFs across every
-- stage. Populated incrementally by the prepare_pages stage.
CREATE TABLE public.plan_review_page_assets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_review_id UUID NOT NULL REFERENCES public.plan_reviews(id) ON DELETE CASCADE,
  firm_id UUID,
  source_file_path TEXT NOT NULL,
  page_index INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (plan_review_id, page_index)
);

CREATE INDEX idx_prpa_plan_review ON public.plan_review_page_assets (plan_review_id, page_index);
CREATE INDEX idx_prpa_status ON public.plan_review_page_assets (plan_review_id, status);

ALTER TABLE public.plan_review_page_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Firm members read plan_review_page_assets"
  ON public.plan_review_page_assets
  FOR SELECT
  TO authenticated
  USING (firm_id IS NULL OR firm_id = user_firm_id(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Firm members insert plan_review_page_assets"
  ON public.plan_review_page_assets
  FOR INSERT
  TO authenticated
  WITH CHECK (firm_id IS NULL OR firm_id = user_firm_id(auth.uid()));

CREATE POLICY "Firm members update plan_review_page_assets"
  ON public.plan_review_page_assets
  FOR UPDATE
  TO authenticated
  USING (firm_id IS NULL OR firm_id = user_firm_id(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));
