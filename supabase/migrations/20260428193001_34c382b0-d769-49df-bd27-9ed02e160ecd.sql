-- =========================================================
-- PHASE 1.2 — FIRM_SETTINGS MULTI-TENANCY FIX
-- =========================================================

ALTER TABLE public.firm_settings
  ADD COLUMN IF NOT EXISTS firm_id uuid REFERENCES public.firms(id) ON DELETE CASCADE;

UPDATE public.firm_settings fs
SET firm_id = public.user_firm_id(fs.user_id)
WHERE fs.firm_id IS NULL;

-- Drop duplicate rows per firm (keep newest)
DELETE FROM public.firm_settings a
USING public.firm_settings b
WHERE a.firm_id = b.firm_id
  AND a.firm_id IS NOT NULL
  AND a.created_at < b.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS firm_settings_firm_id_key
  ON public.firm_settings(firm_id) WHERE firm_id IS NOT NULL;

DROP POLICY IF EXISTS "Users can insert own firm settings" ON public.firm_settings;
DROP POLICY IF EXISTS "Users can read own firm settings" ON public.firm_settings;
DROP POLICY IF EXISTS "Users can update own firm settings" ON public.firm_settings;

CREATE POLICY "Firm members read firm_settings"
  ON public.firm_settings FOR SELECT TO authenticated
  USING (firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Firm members insert firm_settings"
  ON public.firm_settings FOR INSERT TO authenticated
  WITH CHECK (firm_id = public.user_firm_id(auth.uid()));

CREATE POLICY "Firm members update firm_settings"
  ON public.firm_settings FOR UPDATE TO authenticated
  USING (firm_id = public.user_firm_id(auth.uid()) OR public.has_role(auth.uid(), 'admin'::app_role));

DROP TRIGGER IF EXISTS tr_set_firm_id_settings ON public.firm_settings;
CREATE TRIGGER tr_set_firm_id_settings
  BEFORE INSERT ON public.firm_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_firm_id_from_user();

-- =========================================================
-- PHASE 1.3 — HARDEN SECURITY DEFINER FUNCTIONS
-- =========================================================

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_firm_id(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.compute_statutory_deadline(timestamptz, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_fl_state_holiday(date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.generate_invoice_number() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.check_deadline_alerts() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.match_fbc_code_sections(vector, double precision, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.match_correction_embeddings(vector, double precision, integer, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_firm_id(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.compute_statutory_deadline(timestamptz, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_fl_state_holiday(date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_invoice_number() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_deadline_alerts() TO service_role;
GRANT EXECUTE ON FUNCTION public.match_fbc_code_sections(vector, double precision, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.match_correction_embeddings(vector, double precision, integer, uuid) TO authenticated, service_role;