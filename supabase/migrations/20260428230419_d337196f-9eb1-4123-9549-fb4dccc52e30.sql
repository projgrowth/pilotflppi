-- Reviewer professional licenses
CREATE TABLE public.reviewer_licenses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  firm_id UUID,
  discipline TEXT NOT NULL,
  license_type TEXT NOT NULL DEFAULT 'PE',
  license_number TEXT NOT NULL,
  jurisdiction TEXT NOT NULL DEFAULT 'FL',
  expires_on DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reviewer_licenses_user ON public.reviewer_licenses(user_id);
CREATE INDEX idx_reviewer_licenses_firm ON public.reviewer_licenses(firm_id);
CREATE INDEX idx_reviewer_licenses_discipline ON public.reviewer_licenses(discipline) WHERE is_active = true;

ALTER TABLE public.reviewer_licenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own licenses + firm members read firm licenses"
ON public.reviewer_licenses FOR SELECT TO authenticated
USING (user_id = auth.uid() OR (firm_id IS NOT NULL AND firm_id = user_firm_id(auth.uid())) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users insert own licenses"
ON public.reviewer_licenses FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND (firm_id IS NULL OR firm_id = user_firm_id(auth.uid())));

CREATE POLICY "Users update own licenses"
ON public.reviewer_licenses FOR UPDATE TO authenticated
USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users delete own licenses"
ON public.reviewer_licenses FOR DELETE TO authenticated
USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_reviewer_licenses_updated
  BEFORE UPDATE ON public.reviewer_licenses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- AHJ recipient address book
CREATE TABLE public.ahj_recipients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  firm_id UUID,
  jurisdiction TEXT NOT NULL,
  department TEXT,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  notes TEXT NOT NULL DEFAULT '',
  last_used_at TIMESTAMPTZ,
  use_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ahj_recipients_firm ON public.ahj_recipients(firm_id);
CREATE INDEX idx_ahj_recipients_juris ON public.ahj_recipients(jurisdiction);

ALTER TABLE public.ahj_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Firm members read ahj_recipients"
ON public.ahj_recipients FOR SELECT TO authenticated
USING (firm_id IS NULL OR firm_id = user_firm_id(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Firm members insert ahj_recipients"
ON public.ahj_recipients FOR INSERT TO authenticated
WITH CHECK ((created_by IS NULL OR created_by = auth.uid()) AND (firm_id IS NULL OR firm_id = user_firm_id(auth.uid())));

CREATE POLICY "Firm members update ahj_recipients"
ON public.ahj_recipients FOR UPDATE TO authenticated
USING (firm_id IS NULL OR firm_id = user_firm_id(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Firm members delete ahj_recipients"
ON public.ahj_recipients FOR DELETE TO authenticated
USING (firm_id IS NULL OR firm_id = user_firm_id(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_ahj_recipients_updated
  BEFORE UPDATE ON public.ahj_recipients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();