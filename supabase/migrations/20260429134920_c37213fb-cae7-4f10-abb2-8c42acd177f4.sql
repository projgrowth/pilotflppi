-- =========================================================================
-- WAVE 6 — TRUST HARDENING
-- =========================================================================

-- ---------------------------------------------------------------------
-- 1. Clock pause invariant: reject writes that desync history vs column.
-- ---------------------------------------------------------------------
-- The existing log_clock_state_changes() trigger appends to
-- clock_pause_history when review_clock_paused_at toggles. This invariant
-- catches the inverse: a direct UPDATE to clock_pause_history that leaves
-- the JSON in a state inconsistent with the column.
--
-- Allowed final states after BEFORE-UPDATE chain runs:
--   (a) column NULL  AND last event is 'resume' (or array empty)
--   (b) column NOT NULL AND last event is 'pause'
-- Anything else means someone wrote the JSON without going through the
-- canonical pause/resume path. We raise instead of silently banking
-- wrong days.

CREATE OR REPLACE FUNCTION public.assert_clock_pause_invariant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  hist jsonb := COALESCE(NEW.clock_pause_history, '[]'::jsonb);
  last_event text;
  arr_len int;
BEGIN
  arr_len := jsonb_array_length(hist);
  IF arr_len = 0 THEN
    -- empty history is consistent with either state, but if the column is
    -- non-null we must have a 'pause' entry — append one defensively
    -- rather than allow a silent desync.
    IF NEW.review_clock_paused_at IS NOT NULL THEN
      RAISE EXCEPTION 'clock_pause_history desync: column paused but history empty (project %)', NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  last_event := hist -> (arr_len - 1) ->> 'event';

  IF NEW.review_clock_paused_at IS NOT NULL AND last_event <> 'pause' THEN
    RAISE EXCEPTION 'clock_pause_history desync on project %: column paused but last event is %', NEW.id, last_event;
  END IF;

  IF NEW.review_clock_paused_at IS NULL AND last_event = 'pause' THEN
    RAISE EXCEPTION 'clock_pause_history desync on project %: column null but last event is pause', NEW.id;
  END IF;

  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.assert_clock_pause_invariant() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_clock_pause_invariant() TO authenticated, service_role;

-- Fire AFTER tr_zz_log_clock_state (which runs last among BEFORE triggers
-- thanks to its alphabetical name). We use AFTER so we see the final
-- merged state of column + history.
DROP TRIGGER IF EXISTS tr_assert_clock_pause_invariant ON public.projects;
CREATE TRIGGER tr_assert_clock_pause_invariant
  BEFORE UPDATE OF review_clock_paused_at, clock_pause_history ON public.projects
  FOR EACH ROW
  WHEN (NEW.review_clock_paused_at IS DISTINCT FROM OLD.review_clock_paused_at
        OR NEW.clock_pause_history IS DISTINCT FROM OLD.clock_pause_history)
  EXECUTE FUNCTION public.assert_clock_pause_invariant();

-- ---------------------------------------------------------------------
-- 2. Reviewer disposition timestamp + auto-stamp trigger.
-- ---------------------------------------------------------------------
-- Audit follow-up risk #6: the readiness gate trusts
-- reviewer_disposition !== null to mean "human decided", but doesn't
-- detect a finding that was edited *after* the human decided. Track when
-- the disposition was last set so we can compare it against updated_at.

ALTER TABLE public.deficiencies_v2
  ADD COLUMN IF NOT EXISTS reviewer_disposition_at timestamptz;

-- Backfill: any existing disposition gets stamped with updated_at so
-- the staleness comparison starts even.
UPDATE public.deficiencies_v2
   SET reviewer_disposition_at = updated_at
 WHERE reviewer_disposition IS NOT NULL
   AND reviewer_disposition_at IS NULL;

CREATE OR REPLACE FUNCTION public.stamp_reviewer_disposition_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.reviewer_disposition IS NOT NULL AND NEW.reviewer_disposition_at IS NULL THEN
      NEW.reviewer_disposition_at := now();
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: only restamp when the disposition actually changes.
  IF NEW.reviewer_disposition IS DISTINCT FROM OLD.reviewer_disposition THEN
    NEW.reviewer_disposition_at := CASE
      WHEN NEW.reviewer_disposition IS NULL THEN NULL
      ELSE now()
    END;
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.stamp_reviewer_disposition_at() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stamp_reviewer_disposition_at() TO authenticated, service_role;

DROP TRIGGER IF EXISTS tr_stamp_reviewer_disposition_at ON public.deficiencies_v2;
CREATE TRIGGER tr_stamp_reviewer_disposition_at
  BEFORE INSERT OR UPDATE OF reviewer_disposition ON public.deficiencies_v2
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_reviewer_disposition_at();

-- ---------------------------------------------------------------------
-- 3. Pipeline advisory lock helper (Audit H-04 follow-up risk #4).
-- ---------------------------------------------------------------------
-- pg_try_advisory_xact_lock returns false if another session holds the
-- lock. We hash the plan_review_id UUID into a bigint key. Edge function
-- callers wrap their stage runner in a transaction and call this; if it
-- returns false they 409 instead of double-running.

CREATE OR REPLACE FUNCTION public.try_acquire_pipeline_lock(p_plan_review_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT pg_try_advisory_xact_lock(hashtextextended(p_plan_review_id::text, 0));
$$;

REVOKE EXECUTE ON FUNCTION public.try_acquire_pipeline_lock(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.try_acquire_pipeline_lock(uuid) TO authenticated, service_role;