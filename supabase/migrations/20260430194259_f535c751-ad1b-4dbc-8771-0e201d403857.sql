
-- Per-firm feature flags (toggle beta capabilities at runtime)
ALTER TABLE public.firm_settings
  ADD COLUMN IF NOT EXISTS feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Cache of external data lookups (FEMA flood, ASCE wind, etc.)
CREATE TABLE IF NOT EXISTS public.external_data_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_review_id uuid NOT NULL,
  firm_id uuid,
  source text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  fetched_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_data_snapshots_source_chk
    CHECK (source IN ('fema_flood', 'asce_hazard'))
);

CREATE UNIQUE INDEX IF NOT EXISTS external_data_snapshots_pr_source_uniq
  ON public.external_data_snapshots (plan_review_id, source);

CREATE INDEX IF NOT EXISTS external_data_snapshots_firm_idx
  ON public.external_data_snapshots (firm_id);

ALTER TABLE public.external_data_snapshots ENABLE ROW LEVEL SECURITY;

-- Auto-stamp firm_id from the parent plan_review
DROP TRIGGER IF EXISTS external_data_snapshots_set_firm
  ON public.external_data_snapshots;
CREATE TRIGGER external_data_snapshots_set_firm
  BEFORE INSERT ON public.external_data_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.set_firm_id_from_plan_review();

-- Auto-bump updated_at on refresh
DROP TRIGGER IF EXISTS external_data_snapshots_touch
  ON public.external_data_snapshots;
CREATE TRIGGER external_data_snapshots_touch
  BEFORE UPDATE ON public.external_data_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS: firm-scoped read/insert/update; no delete
CREATE POLICY "Firm members read external_data_snapshots"
  ON public.external_data_snapshots
  FOR SELECT
  TO authenticated
  USING (
    firm_id IS NULL
    OR firm_id = public.user_firm_id(auth.uid())
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  );

CREATE POLICY "Firm members insert external_data_snapshots"
  ON public.external_data_snapshots
  FOR INSERT
  TO authenticated
  WITH CHECK (
    firm_id IS NULL
    OR firm_id = public.user_firm_id(auth.uid())
  );

CREATE POLICY "Firm members update external_data_snapshots"
  ON public.external_data_snapshots
  FOR UPDATE
  TO authenticated
  USING (
    firm_id IS NULL
    OR firm_id = public.user_firm_id(auth.uid())
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  );
