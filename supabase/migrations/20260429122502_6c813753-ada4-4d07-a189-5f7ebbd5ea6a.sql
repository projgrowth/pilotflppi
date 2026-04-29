-- Revoke EXECUTE on remaining internal helpers from authenticated/anon.
-- These are only called by edge functions (which use service-role and bypass
-- grants) or from inside RLS policies (which run as the function's definer).
DO $$
DECLARE
  fn text;
  internal_fns text[] := ARRAY[
    'match_correction_embeddings(vector, double precision, integer, uuid)',
    'match_correction_patterns(vector, double precision, integer, uuid, text)',
    'match_fbc_code_sections(vector, double precision, integer)',
    'user_firm_id(uuid)',
    'compute_statutory_deadline(timestamp with time zone, integer)',
    'is_fl_state_holiday(date)'
  ];
BEGIN
  FOREACH fn IN ARRAY internal_fns LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXCEPTION WHEN undefined_function THEN NULL;
    END;
  END LOOP;
END $$;
