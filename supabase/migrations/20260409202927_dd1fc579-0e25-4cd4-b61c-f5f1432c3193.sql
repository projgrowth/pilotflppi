
-- Fee schedules table
CREATE TABLE public.fee_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  service_type text NOT NULL DEFAULT 'plan_review',
  trade_type text NOT NULL DEFAULT 'building',
  county text NOT NULL DEFAULT '',
  base_fee numeric(10,2) NOT NULL DEFAULT 0,
  description text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fee_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own fee schedules" ON public.fee_schedules FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can insert own fee schedules" ON public.fee_schedules FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own fee schedules" ON public.fee_schedules FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own fee schedules" ON public.fee_schedules FOR DELETE USING (user_id = auth.uid());

CREATE TRIGGER update_fee_schedules_updated_at BEFORE UPDATE ON public.fee_schedules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Invoices table
CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  contractor_id uuid REFERENCES public.contractors(id) ON DELETE SET NULL,
  invoice_number text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft',
  issued_at timestamptz,
  due_at timestamptz,
  paid_at timestamptz,
  subtotal numeric(10,2) NOT NULL DEFAULT 0,
  tax_rate numeric(5,4) NOT NULL DEFAULT 0,
  tax_amount numeric(10,2) NOT NULL DEFAULT 0,
  total numeric(10,2) NOT NULL DEFAULT 0,
  amount_paid numeric(10,2) NOT NULL DEFAULT 0,
  notes text NOT NULL DEFAULT '',
  custom_footer text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own invoices" ON public.invoices FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can insert own invoices" ON public.invoices FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own invoices" ON public.invoices FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own invoices" ON public.invoices FOR DELETE USING (user_id = auth.uid());

CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Invoice line items table
CREATE TABLE public.invoice_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE CASCADE NOT NULL,
  description text NOT NULL DEFAULT '',
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric(10,2) NOT NULL DEFAULT 0,
  total numeric(10,2) NOT NULL DEFAULT 0,
  service_type text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.invoice_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own invoice line items" ON public.invoice_line_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.invoices WHERE invoices.id = invoice_line_items.invoice_id AND invoices.user_id = auth.uid()));
CREATE POLICY "Users can insert own invoice line items" ON public.invoice_line_items FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.invoices WHERE invoices.id = invoice_line_items.invoice_id AND invoices.user_id = auth.uid()));
CREATE POLICY "Users can update own invoice line items" ON public.invoice_line_items FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.invoices WHERE invoices.id = invoice_line_items.invoice_id AND invoices.user_id = auth.uid()));
CREATE POLICY "Users can delete own invoice line items" ON public.invoice_line_items FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.invoices WHERE invoices.id = invoice_line_items.invoice_id AND invoices.user_id = auth.uid()));

-- Auto-generate invoice number function
CREATE OR REPLACE FUNCTION public.generate_invoice_number()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'FPP-' || to_char(now(), 'YYYY') || '-' || lpad(
    (COALESCE((SELECT COUNT(*) FROM public.invoices WHERE created_at >= date_trunc('year', now())), 0) + 1)::text,
    4, '0'
  );
$$;

-- Index for fast lookups
CREATE INDEX idx_invoices_project_id ON public.invoices(project_id);
CREATE INDEX idx_invoices_user_id ON public.invoices(user_id);
CREATE INDEX idx_invoices_status ON public.invoices(status);
CREATE INDEX idx_invoice_line_items_invoice_id ON public.invoice_line_items(invoice_id);
CREATE INDEX idx_fee_schedules_user_id ON public.fee_schedules(user_id);
