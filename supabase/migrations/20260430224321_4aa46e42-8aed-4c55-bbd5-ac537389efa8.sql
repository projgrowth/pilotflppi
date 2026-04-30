-- Tier 1 input-layer upgrade: persist PDF text + cross-reference graph

-- 1) Per-page extracted text from pdf.js getTextContent()
CREATE TABLE public.plan_review_page_text (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_review_id UUID NOT NULL,
  firm_id UUID NULL,
  page_index INTEGER NOT NULL,
  sheet_ref TEXT NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  full_text TEXT NOT NULL DEFAULT '',
  has_text_layer BOOLEAN NOT NULL DEFAULT true,
  char_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT plan_review_page_text_unique UNIQUE (plan_review_id, page_index)
);

CREATE INDEX idx_plan_review_page_text_review ON public.plan_review_page_text(plan_review_id);
CREATE INDEX idx_plan_review_page_text_sheet ON public.plan_review_page_text(plan_review_id, sheet_ref);

ALTER TABLE public.plan_review_page_text ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Firm members read page_text"
  ON public.plan_review_page_text FOR SELECT TO authenticated
  USING (firm_id IS NULL OR firm_id = user_firm_id(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Firm members insert page_text"
  ON public.plan_review_page_text FOR INSERT TO authenticated
  WITH CHECK (firm_id IS NULL OR firm_id = user_firm_id(auth.uid()));

CREATE POLICY "Firm members update page_text"
  ON public.plan_review_page_text FOR UPDATE TO authenticated
  USING (firm_id IS NULL OR firm_id = user_firm_id(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins delete page_text"
  ON public.plan_review_page_text FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_plan_review_page_text_updated_at
  BEFORE UPDATE ON public.plan_review_page_text
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Cross-sheet callout references parsed from page text
CREATE TABLE public.callout_references (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_review_id UUID NOT NULL,
  firm_id UUID NULL,
  source_page INTEGER NOT NULL,
  source_sheet_ref TEXT NULL,
  raw_text TEXT NOT NULL,
  callout_kind TEXT NOT NULL DEFAULT 'detail',
  target_sheet_ref TEXT NULL,
  target_detail TEXT NULL,
  resolved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_callout_references_review ON public.callout_references(plan_review_id);
CREATE INDEX idx_callout_references_unresolved ON public.callout_references(plan_review_id, resolved);

ALTER TABLE public.callout_references ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Firm members read callout_references"
  ON public.callout_references FOR SELECT TO authenticated
  USING (firm_id IS NULL OR firm_id = user_firm_id(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Firm members insert callout_references"
  ON public.callout_references FOR INSERT TO authenticated
  WITH CHECK (firm_id IS NULL OR firm_id = user_firm_id(auth.uid()));

CREATE POLICY "Firm members delete callout_references"
  ON public.callout_references FOR DELETE TO authenticated
  USING (firm_id IS NULL OR firm_id = user_firm_id(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));
