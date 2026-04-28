
-- =========================================================================
-- PART 1: REGISTER ORPHANED TRIGGERS
-- =========================================================================

-- Statutory clock auto-management on projects
CREATE TRIGGER tr_auto_manage_statutory_clock
  BEFORE UPDATE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_manage_statutory_clock();

-- Auto status advancement when plan review completes
CREATE TRIGGER tr_auto_advance_on_plan_review
  AFTER INSERT OR UPDATE ON public.plan_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_advance_project_status();

-- Auto status advancement on inspection events
CREATE TRIGGER tr_auto_advance_on_inspection
  AFTER INSERT OR UPDATE ON public.inspections
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_advance_project_status();

-- Reset statutory clock on resubmission (new round inserted)
CREATE TRIGGER tr_reset_clock_on_resubmission
  AFTER INSERT ON public.plan_reviews
  FOR EACH ROW
  WHEN (NEW.round > 1)
  EXECUTE FUNCTION public.reset_review_clock_on_resubmission();

-- Start inspection clock when first inspection scheduled
CREATE TRIGGER tr_set_inspection_clock
  AFTER INSERT ON public.inspections
  FOR EACH ROW
  EXECUTE FUNCTION public.set_inspection_clock_on_schedule();

-- FBC text-change handling
CREATE TRIGGER tr_clear_fbc_embedding
  BEFORE UPDATE ON public.fbc_code_sections
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_fbc_embedding_on_text_change();

CREATE TRIGGER tr_flag_findings_reground
  AFTER UPDATE ON public.fbc_code_sections
  FOR EACH ROW
  EXECUTE FUNCTION public.flag_findings_for_reground_on_canonical_change();

-- updated_at maintenance on every table that has the column
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema='public' AND c.column_name='updated_at'
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS tr_set_updated_at ON public.%I; '
      'CREATE TRIGGER tr_set_updated_at BEFORE UPDATE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();',
      r.table_name, r.table_name
    );
  END LOOP;
END $$;

-- firm_id auto-population on firm-scoped tables.
-- firm_settings uses its own NEW.firm_id := user_firm_id() logic via the existing
-- set_firm_id_settings trigger (created in Phase 1) — skip it here to avoid duplicate.
DO $$
DECLARE
  tables text[] := ARRAY[
    'activity_log','ai_outputs','applied_corrections','certificates_of_compliance',
    'comment_letter_snapshots','contractors','correction_patterns','corrections',
    'deferred_scope_items','deficiencies_v2','fee_schedules',
    'inspection_photos','inspection_reports','inspections','invoices',
    'milestone_buildings','permit_leads','plan_reviews','projects'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS tr_set_firm_id ON public.%I; '
      'CREATE TRIGGER tr_set_firm_id BEFORE INSERT ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.set_firm_id_from_user();',
      t, t
    );
  END LOOP;
END $$;

-- finding_status_history derives firm_id from the parent plan_review
DROP TRIGGER IF EXISTS tr_set_firm_id_history ON public.finding_status_history;
CREATE TRIGGER tr_set_firm_id_history
  BEFORE INSERT ON public.finding_status_history
  FOR EACH ROW
  EXECUTE FUNCTION public.set_firm_id_from_plan_review();

-- =========================================================================
-- PART 2: COMMENT LETTER DELIVERY TRACKING
-- =========================================================================
ALTER TABLE public.comment_letter_snapshots
  ADD COLUMN IF NOT EXISTS delivery_method text,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_confirmation text,
  ADD COLUMN IF NOT EXISTS delivery_notes text;

ALTER TABLE public.comment_letter_snapshots
  DROP CONSTRAINT IF EXISTS comment_letter_snapshots_delivery_method_check;
ALTER TABLE public.comment_letter_snapshots
  ADD CONSTRAINT comment_letter_snapshots_delivery_method_check
  CHECK (delivery_method IS NULL OR delivery_method IN ('email','portal','hand_delivered','certified_mail','fax','other'));

-- Loosen the "no UPDATE" rule so reviewers can record delivery confirmation
-- AFTER the immutable snapshot was created. Letter content (html/hash/findings)
-- stays immutable via a column-level trigger.
CREATE POLICY "Firm members update letter delivery"
  ON public.comment_letter_snapshots FOR UPDATE TO authenticated
  USING ((firm_id IS NULL) OR (firm_id = user_firm_id(auth.uid())) OR has_role(auth.uid(),'admin'::app_role));

CREATE OR REPLACE FUNCTION public.protect_letter_snapshot_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.letter_html IS DISTINCT FROM OLD.letter_html
     OR NEW.letter_html_sha256 IS DISTINCT FROM OLD.letter_html_sha256
     OR NEW.findings_json IS DISTINCT FROM OLD.findings_json
     OR NEW.firm_info_json IS DISTINCT FROM OLD.firm_info_json
     OR NEW.readiness_snapshot IS DISTINCT FROM OLD.readiness_snapshot
     OR NEW.sent_at IS DISTINCT FROM OLD.sent_at
     OR NEW.sent_by IS DISTINCT FROM OLD.sent_by
     OR NEW.recipient IS DISTINCT FROM OLD.recipient
     OR NEW.round IS DISTINCT FROM OLD.round
     OR NEW.plan_review_id IS DISTINCT FROM OLD.plan_review_id THEN
    RAISE EXCEPTION 'Letter snapshot content is immutable. Only delivery_* fields and pdf_storage_path may be updated.';
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.protect_letter_snapshot_immutable() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.protect_letter_snapshot_immutable() TO authenticated, service_role;

CREATE TRIGGER tr_protect_letter_snapshot
  BEFORE UPDATE ON public.comment_letter_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_letter_snapshot_immutable();

-- =========================================================================
-- PART 3: STATUTORY CLOCK PAUSE/RESUME REASON CAPTURE
-- =========================================================================
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS clock_resume_reason text,
  ADD COLUMN IF NOT EXISTS clock_resumed_at timestamptz;

CREATE OR REPLACE FUNCTION public.log_clock_state_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  reason_text text;
BEGIN
  -- Pause event: paused_at went from NULL to a value
  IF NEW.review_clock_paused_at IS NOT NULL
     AND OLD.review_clock_paused_at IS NULL THEN
    reason_text := COALESCE(
      NEW.clock_pause_reason,
      CASE WHEN NEW.status = 'comments_sent' THEN 'Comments sent — awaiting resubmittal'
           ELSE 'Clock paused' END
    );
    NEW.clock_pause_reason := reason_text;
    NEW.clock_pause_history := COALESCE(NEW.clock_pause_history,'[]'::jsonb)
      || jsonb_build_object(
        'event','pause',
        'at', to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'reason', reason_text,
        'status', NEW.status::text
      );
    INSERT INTO public.activity_log (event_type, description, project_id, actor_type, metadata)
    VALUES ('statutory_clock_paused',
            'Statutory clock paused: ' || reason_text,
            NEW.id, 'system',
            jsonb_build_object('reason', reason_text, 'status', NEW.status));
  END IF;

  -- Resume event: paused_at went from a value to NULL
  IF NEW.review_clock_paused_at IS NULL
     AND OLD.review_clock_paused_at IS NOT NULL THEN
    reason_text := COALESCE(
      NEW.clock_resume_reason,
      CASE WHEN NEW.status = 'resubmitted' THEN 'Resubmittal received'
           ELSE 'Clock resumed' END
    );
    NEW.clock_resume_reason := reason_text;
    NEW.clock_resumed_at := now();
    NEW.clock_pause_history := COALESCE(NEW.clock_pause_history,'[]'::jsonb)
      || jsonb_build_object(
        'event','resume',
        'at', to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'reason', reason_text,
        'status', NEW.status::text
      );
    INSERT INTO public.activity_log (event_type, description, project_id, actor_type, metadata)
    VALUES ('statutory_clock_resumed',
            'Statutory clock resumed: ' || reason_text,
            NEW.id, 'system',
            jsonb_build_object('reason', reason_text, 'status', NEW.status));
  END IF;

  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.log_clock_state_changes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_clock_state_changes() TO authenticated, service_role;

-- Run AFTER auto_manage_statutory_clock so it sees the final paused_at value.
-- Both are BEFORE UPDATE; trigger order is alphabetical, so name this 'tr_zz_'
-- to ensure it fires last.
CREATE TRIGGER tr_zz_log_clock_state
  BEFORE UPDATE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.log_clock_state_changes();
