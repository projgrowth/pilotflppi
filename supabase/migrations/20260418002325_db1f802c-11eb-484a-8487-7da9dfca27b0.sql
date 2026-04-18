-- ============================================================
-- Phase 2: Firm tenancy
-- Adds firm_id scoping to every business table.
-- Soft RLS: policies allow firm_id IS NULL for one release as a safety net.
-- ============================================================

-- ----- 1. firms + firm_members -----

CREATE TABLE public.firms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.firm_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (firm_id, user_id)
);
CREATE INDEX firm_members_user_id_idx ON public.firm_members(user_id);

ALTER TABLE public.firms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firm_members ENABLE ROW LEVEL SECURITY;

-- ----- 2. user_firm_id() helper (SECURITY DEFINER, no recursion) -----

CREATE OR REPLACE FUNCTION public.user_firm_id(_user uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT firm_id
  FROM public.firm_members
  WHERE user_id = _user
  ORDER BY created_at ASC
  LIMIT 1
$$;

-- RLS for firms / firm_members (use the helper, not self-references)
CREATE POLICY "Members can read own firm"
ON public.firms FOR SELECT TO authenticated
USING (id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert firms"
ON public.firms FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Owners can update own firm"
ON public.firms FOR UPDATE TO authenticated
USING (owner_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Members can read own membership rows"
ON public.firm_members FOR SELECT TO authenticated
USING (user_id = auth.uid() OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert memberships"
ON public.firm_members FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete memberships"
ON public.firm_members FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- ----- 3. Default Firm + backfill memberships -----

INSERT INTO public.firms (id, name, owner_user_id)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Firm', NULL);

INSERT INTO public.firm_members (firm_id, user_id)
SELECT '00000000-0000-0000-0000-000000000001'::uuid, id
FROM auth.users
ON CONFLICT (firm_id, user_id) DO NOTHING;

-- ----- 4. Add firm_id to every business table + backfill -----

DO $$
DECLARE
  t text;
  business_tables text[] := ARRAY[
    'projects','plan_reviews','contractors','invoices','invoice_line_items',
    'fee_schedules','corrections','ai_outputs','review_flags','deficiencies',
    'permit_leads','milestone_buildings','activity_log','finding_status_history',
    'plan_review_files','deadline_alerts','statutory_alerts','inspections'
  ];
BEGIN
  FOREACH t IN ARRAY business_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS firm_id uuid', t);
    EXECUTE format('UPDATE public.%I SET firm_id = ''00000000-0000-0000-0000-000000000001'' WHERE firm_id IS NULL', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I(firm_id)', t || '_firm_id_idx', t);
  END LOOP;
END$$;

-- ----- 5. Default firm_id on insert: trigger that fills firm_id from the caller's membership -----

CREATE OR REPLACE FUNCTION public.set_firm_id_from_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.firm_id IS NULL THEN
    NEW.firm_id := public.user_firm_id(auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
  business_tables text[] := ARRAY[
    'projects','plan_reviews','contractors','invoices','invoice_line_items',
    'fee_schedules','corrections','ai_outputs','review_flags','deficiencies',
    'permit_leads','milestone_buildings','activity_log','finding_status_history',
    'plan_review_files','deadline_alerts','statutory_alerts','inspections'
  ];
BEGIN
  FOREACH t IN ARRAY business_tables LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS set_firm_id ON public.%I; CREATE TRIGGER set_firm_id BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_firm_id_from_user()',
      t, t
    );
  END LOOP;
END$$;

-- ----- 6. Rewrite every USING (true) policy to firm-scoped (soft: allows firm_id IS NULL) -----

-- Helper macro idea (inlined): drop old broad policies, create scoped ones.
-- We do this table-by-table because policy names differ.

-- projects
DROP POLICY IF EXISTS "Authenticated users can read projects" ON public.projects;
DROP POLICY IF EXISTS "Authenticated users can insert projects" ON public.projects;
DROP POLICY IF EXISTS "Authenticated users can update projects" ON public.projects;
DROP POLICY IF EXISTS "Authenticated users can delete projects" ON public.projects;
CREATE POLICY "Firm members read projects" ON public.projects FOR SELECT TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Firm members insert projects" ON public.projects FOR INSERT TO authenticated
  WITH CHECK (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()));
CREATE POLICY "Firm members update projects" ON public.projects FOR UPDATE TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Firm members delete projects" ON public.projects FOR DELETE TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'));

-- plan_reviews
DROP POLICY IF EXISTS "Authenticated users can read plan_reviews" ON public.plan_reviews;
DROP POLICY IF EXISTS "Authenticated users can insert plan_reviews" ON public.plan_reviews;
DROP POLICY IF EXISTS "Authenticated users can update plan_reviews" ON public.plan_reviews;
CREATE POLICY "Firm members read plan_reviews" ON public.plan_reviews FOR SELECT TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Firm members insert plan_reviews" ON public.plan_reviews FOR INSERT TO authenticated
  WITH CHECK (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()));
CREATE POLICY "Firm members update plan_reviews" ON public.plan_reviews FOR UPDATE TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'));

-- contractors
DROP POLICY IF EXISTS "Authenticated users can read contractors" ON public.contractors;
DROP POLICY IF EXISTS "Authenticated users can insert contractors" ON public.contractors;
DROP POLICY IF EXISTS "Authenticated users can update contractors" ON public.contractors;
DROP POLICY IF EXISTS "Authenticated users can delete contractors" ON public.contractors;
CREATE POLICY "Firm members read contractors" ON public.contractors FOR SELECT TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Firm members insert contractors" ON public.contractors FOR INSERT TO authenticated
  WITH CHECK (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()));
CREATE POLICY "Firm members update contractors" ON public.contractors FOR UPDATE TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Firm members delete contractors" ON public.contractors FOR DELETE TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'));

-- invoices (already user_id-scoped — keep that AND add firm scope; the firm scope is the OR-guard)
DROP POLICY IF EXISTS "Users can read own invoices" ON public.invoices;
DROP POLICY IF EXISTS "Users can insert own invoices" ON public.invoices;
DROP POLICY IF EXISTS "Users can update own invoices" ON public.invoices;
DROP POLICY IF EXISTS "Users can delete own invoices" ON public.invoices;
CREATE POLICY "Firm members read invoices" ON public.invoices FOR SELECT TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Firm members insert invoices" ON public.invoices FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid())));
CREATE POLICY "Firm members update invoices" ON public.invoices FOR UPDATE TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Firm members delete invoices" ON public.invoices FOR DELETE TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'));

-- invoice_line_items: scope through parent invoice firm_id
DROP POLICY IF EXISTS "Users can read own invoice line items" ON public.invoice_line_items;
DROP POLICY IF EXISTS "Users can insert own invoice line items" ON public.invoice_line_items;
DROP POLICY IF EXISTS "Users can update own invoice line items" ON public.invoice_line_items;
DROP POLICY IF EXISTS "Users can delete own invoice line items" ON public.invoice_line_items;
CREATE POLICY "Firm members read invoice line items" ON public.invoice_line_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id
    AND (i.firm_id IS NULL OR i.firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'))));
CREATE POLICY "Firm members insert invoice line items" ON public.invoice_line_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id
    AND (i.firm_id IS NULL OR i.firm_id = public.user_firm_id(auth.uid()))));
CREATE POLICY "Firm members update invoice line items" ON public.invoice_line_items FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id
    AND (i.firm_id IS NULL OR i.firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'))));
CREATE POLICY "Firm members delete invoice line items" ON public.invoice_line_items FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id
    AND (i.firm_id IS NULL OR i.firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'))));

-- fee_schedules (was user_id-scoped — keep user_id AND add firm scope)
DROP POLICY IF EXISTS "Users can read own fee schedules" ON public.fee_schedules;
DROP POLICY IF EXISTS "Users can insert own fee schedules" ON public.fee_schedules;
DROP POLICY IF EXISTS "Users can update own fee schedules" ON public.fee_schedules;
DROP POLICY IF EXISTS "Users can delete own fee schedules" ON public.fee_schedules;
CREATE POLICY "Firm members read fee schedules" ON public.fee_schedules FOR SELECT TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Firm members insert fee schedules" ON public.fee_schedules FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid())));
CREATE POLICY "Firm members update fee schedules" ON public.fee_schedules FOR UPDATE TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Firm members delete fee schedules" ON public.fee_schedules FOR DELETE TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'));

-- corrections (was user_id-scoped — extend with firm)
DROP POLICY IF EXISTS "Authenticated users can read corrections" ON public.corrections;
DROP POLICY IF EXISTS "Users can insert own corrections" ON public.corrections;
DROP POLICY IF EXISTS "Users can update own corrections" ON public.corrections;
CREATE POLICY "Firm members read corrections" ON public.corrections FOR SELECT TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Firm members insert corrections" ON public.corrections FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid())));
CREATE POLICY "Firm members update corrections" ON public.corrections FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid())));

-- ai_outputs
DROP POLICY IF EXISTS "Authenticated users can read ai_outputs" ON public.ai_outputs;
DROP POLICY IF EXISTS "Authenticated users can insert ai_outputs" ON public.ai_outputs;
DROP POLICY IF EXISTS "Authenticated users can update ai_outputs" ON public.ai_outputs;
CREATE POLICY "Firm members read ai_outputs" ON public.ai_outputs FOR SELECT TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Firm members insert ai_outputs" ON public.ai_outputs FOR INSERT TO authenticated
  WITH CHECK (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()));
CREATE POLICY "Firm members update ai_outputs" ON public.ai_outputs FOR UPDATE TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'));

-- review_flags
DROP POLICY IF EXISTS "Authenticated users can read review_flags" ON public.review_flags;
DROP POLICY IF EXISTS "Authenticated users can insert review_flags" ON public.review_flags;
DROP POLICY IF EXISTS "Authenticated users can update review_flags" ON public.review_flags;
DROP POLICY IF EXISTS "Authenticated users can delete review_flags" ON public.review_flags;
CREATE POLICY "Firm members read review_flags" ON public.review_flags FOR SELECT TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Firm members insert review_flags" ON public.review_flags FOR INSERT TO authenticated
  WITH CHECK (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()));
CREATE POLICY "Firm members update review_flags" ON public.review_flags FOR UPDATE TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Firm members delete review_flags" ON public.review_flags FOR DELETE TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'));

-- deficiencies (this is a code-reference catalog; consider it shared. Allow read for everyone, restrict writes to admin.)
DROP POLICY IF EXISTS "Authenticated users can read deficiencies" ON public.deficiencies;
DROP POLICY IF EXISTS "Authenticated users can insert deficiencies" ON public.deficiencies;
DROP POLICY IF EXISTS "Authenticated users can update deficiencies" ON public.deficiencies;
DROP POLICY IF EXISTS "Authenticated users can delete deficiencies" ON public.deficiencies;
CREATE POLICY "All authenticated read deficiencies" ON public.deficiencies FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins insert deficiencies" ON public.deficiencies FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins update deficiencies" ON public.deficiencies FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins delete deficiencies" ON public.deficiencies FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- permit_leads
DROP POLICY IF EXISTS "Authenticated users can read permit_leads" ON public.permit_leads;
DROP POLICY IF EXISTS "Authenticated users can insert permit_leads" ON public.permit_leads;
DROP POLICY IF EXISTS "Authenticated users can update permit_leads" ON public.permit_leads;
CREATE POLICY "Firm members read permit_leads" ON public.permit_leads FOR SELECT TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Firm members insert permit_leads" ON public.permit_leads FOR INSERT TO authenticated
  WITH CHECK (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()));
CREATE POLICY "Firm members update permit_leads" ON public.permit_leads FOR UPDATE TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'));

-- milestone_buildings
DROP POLICY IF EXISTS "Authenticated users can read milestone_buildings" ON public.milestone_buildings;
DROP POLICY IF EXISTS "Authenticated users can insert milestone_buildings" ON public.milestone_buildings;
DROP POLICY IF EXISTS "Authenticated users can update milestone_buildings" ON public.milestone_buildings;
CREATE POLICY "Firm members read milestone_buildings" ON public.milestone_buildings FOR SELECT TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Firm members insert milestone_buildings" ON public.milestone_buildings FOR INSERT TO authenticated
  WITH CHECK (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()));
CREATE POLICY "Firm members update milestone_buildings" ON public.milestone_buildings FOR UPDATE TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'));

-- activity_log
DROP POLICY IF EXISTS "Authenticated users can read activity_log" ON public.activity_log;
DROP POLICY IF EXISTS "Users can only log as themselves" ON public.activity_log;
CREATE POLICY "Firm members read activity_log" ON public.activity_log FOR SELECT TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Firm members insert activity_log" ON public.activity_log FOR INSERT TO authenticated
  WITH CHECK ((actor_id = auth.uid() OR actor_type = 'system') AND (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid())));

-- finding_status_history
DROP POLICY IF EXISTS "Authenticated users can read finding history" ON public.finding_status_history;
DROP POLICY IF EXISTS "Users can insert own finding history" ON public.finding_status_history;
CREATE POLICY "Firm members read finding history" ON public.finding_status_history FOR SELECT TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Firm members insert finding history" ON public.finding_status_history FOR INSERT TO authenticated
  WITH CHECK (changed_by = auth.uid() AND (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid())));

-- plan_review_files
DROP POLICY IF EXISTS "Authenticated users can read plan review files" ON public.plan_review_files;
DROP POLICY IF EXISTS "Authenticated users can insert plan review files" ON public.plan_review_files;
CREATE POLICY "Firm members read plan review files" ON public.plan_review_files FOR SELECT TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Firm members insert plan review files" ON public.plan_review_files FOR INSERT TO authenticated
  WITH CHECK (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()));

-- deadline_alerts
DROP POLICY IF EXISTS "Authenticated users can read deadline alerts" ON public.deadline_alerts;
DROP POLICY IF EXISTS "Authenticated users can update deadline alerts" ON public.deadline_alerts;
CREATE POLICY "Firm members read deadline alerts" ON public.deadline_alerts FOR SELECT TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Firm members update deadline alerts" ON public.deadline_alerts FOR UPDATE TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'));

-- statutory_alerts
DROP POLICY IF EXISTS "Authenticated users can read statutory alerts" ON public.statutory_alerts;
DROP POLICY IF EXISTS "Authenticated users can update statutory alerts" ON public.statutory_alerts;
DROP POLICY IF EXISTS "System can insert statutory alerts" ON public.statutory_alerts;
CREATE POLICY "Firm members read statutory alerts" ON public.statutory_alerts FOR SELECT TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Firm members update statutory alerts" ON public.statutory_alerts FOR UPDATE TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Firm members insert statutory alerts" ON public.statutory_alerts FOR INSERT TO authenticated
  WITH CHECK (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()));

-- inspections
DROP POLICY IF EXISTS "Authenticated users can read inspections" ON public.inspections;
DROP POLICY IF EXISTS "Authenticated users can insert inspections" ON public.inspections;
DROP POLICY IF EXISTS "Authenticated users can update inspections" ON public.inspections;
CREATE POLICY "Firm members read inspections" ON public.inspections FOR SELECT TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Firm members insert inspections" ON public.inspections FOR INSERT TO authenticated
  WITH CHECK (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()));
CREATE POLICY "Firm members update inspections" ON public.inspections FOR UPDATE TO authenticated
  USING (firm_id IS NULL OR firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(),'admin'));

-- ----- 7. Auto-assign new signups to a personal firm (extend handle_new_user) -----

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_firm_id uuid;
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), 'reviewer');

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'reviewer'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  -- Phase 2: every new signup gets their own firm.
  INSERT INTO public.firms (name, owner_user_id)
  VALUES (COALESCE(NEW.raw_user_meta_data->>'firm_name', 'My Firm'), NEW.id)
  RETURNING id INTO new_firm_id;

  INSERT INTO public.firm_members (firm_id, user_id)
  VALUES (new_firm_id, NEW.id);

  RETURN NEW;
END;
$function$;