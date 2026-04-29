-- Revoke EXECUTE from anon + authenticated on internal SECURITY DEFINER
-- functions that should only ever run inside triggers / migrations.
-- These were flagged by the Supabase linter (warnings 0028 + 0029).
-- Each is verified unused by the application client (see grep audit).

DO $$
DECLARE
  fn text;
  internal_fns text[] := ARRAY[
    'merge_review_progress(uuid, jsonb)',
    'auto_advance_project_status()',
    'set_firm_id_from_user()',
    'set_firm_id_from_plan_review()',
    'handle_new_user()',
    'compute_letter_snapshot_chained_hash()',
    'protect_letter_snapshot_immutable()',
    'advance_project_on_letter_sent()',
    'auto_manage_statutory_clock()',
    'log_clock_state_changes()',
    'set_inspection_clock_on_schedule()',
    'reset_review_clock_on_resubmission()',
    'flag_findings_for_reground_on_canonical_change()',
    'clear_pattern_embedding_on_text_change()',
    'clear_fbc_embedding_on_text_change()',
    'update_updated_at_column()',
    'check_deadline_alerts()'
  ];
BEGIN
  FOREACH fn IN ARRAY internal_fns LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXCEPTION WHEN undefined_function THEN
      -- Function doesn't exist in this database; safe to skip.
      NULL;
    END;
  END LOOP;
END $$;
