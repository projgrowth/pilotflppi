-- =========================================================================
-- Phase 4: Operational hardening, statute compliance fields, audit chaining
-- =========================================================================

-- 1) Cron schedules ---------------------------------------------------------
-- Idempotent: unschedule by name first if present.
DO $$
DECLARE
  j_id bigint;
BEGIN
  SELECT jobid INTO j_id FROM cron.job WHERE jobname = 'check_deadline_alerts_15m';
  IF j_id IS NOT NULL THEN PERFORM cron.unschedule(j_id); END IF;

  SELECT jobid INTO j_id FROM cron.job WHERE jobname = 'reconcile_stuck_reviews_5m';
  IF j_id IS NOT NULL THEN PERFORM cron.unschedule(j_id); END IF;
END $$;

SELECT cron.schedule(
  'check_deadline_alerts_15m',
  '*/15 * * * *',
  $$ SELECT public.check_deadline_alerts(); $$
);

SELECT cron.schedule(
  'reconcile_stuck_reviews_5m',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://iisgxjneamwbehipgcmg.supabase.co/functions/v1/reconcile-stuck-reviews',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- 2) Index for reconciliation lookup ---------------------------------------
CREATE INDEX IF NOT EXISTS idx_plan_reviews_ai_check_status
  ON public.plan_reviews(ai_check_status)
  WHERE ai_check_status IN ('running', 'queued');

-- 3) Auto-advance guard: don't overwrite manual status on re-runs ----------
CREATE OR REPLACE FUNCTION public.auto_advance_project_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  current_status text;
  new_status text := NULL;
  letter_exists boolean := false;
BEGIN
  IF TG_TABLE_NAME = 'plan_reviews' THEN
    SELECT status INTO current_status FROM public.projects WHERE id = NEW.project_id;

    IF TG_OP = 'INSERT' THEN
      IF current_status = 'intake' THEN
        new_status := 'plan_review';
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.ai_check_status = 'complete'
         AND (OLD.ai_check_status IS DISTINCT FROM 'complete') THEN
        -- Only advance if still in early stages AND no letter has been sent
        -- for this plan_review's current round. Prevents AI re-runs after a
        -- resubmission from rewinding the project status.
        SELECT EXISTS (
          SELECT 1 FROM public.comment_letter_snapshots
          WHERE plan_review_id = NEW.id
            AND round = COALESCE(NEW.round, 1)
        ) INTO letter_exists;

        IF current_status IN ('intake', 'plan_review') AND NOT letter_exists THEN
          new_status := 'comments_sent';
        END IF;
      END IF;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'inspections' THEN
    SELECT status INTO current_status FROM public.projects WHERE id = NEW.project_id;

    IF TG_OP = 'INSERT' THEN
      IF current_status IN ('intake', 'plan_review', 'comments_sent', 'resubmitted', 'approved', 'permit_issued') THEN
        new_status := 'inspection_scheduled';
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.result = 'pass' AND NEW.certificate_issued = true
         AND (OLD.result IS DISTINCT FROM 'pass' OR OLD.certificate_issued IS DISTINCT FROM true) THEN
        new_status := 'certificate_issued';
      END IF;
    END IF;
  END IF;

  IF new_status IS NOT NULL THEN
    UPDATE public.projects SET status = new_status::project_status, updated_at = now()
    WHERE id = NEW.project_id;

    INSERT INTO public.activity_log (event_type, description, project_id, actor_type, metadata)
    VALUES (
      'status_auto_advanced',
      'Project status automatically advanced from ' || current_status || ' to ' || new_status,
      NEW.project_id,
      'system',
      jsonb_build_object('old_status', current_status, 'new_status', new_status, 'trigger_table', TG_TABLE_NAME)
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- 4) Comment letter snapshot chained hash (F.S. 553.791(5) audit trail) ----
ALTER TABLE public.comment_letter_snapshots
  ADD COLUMN IF NOT EXISTS chained_hash text,
  ADD COLUMN IF NOT EXISTS previous_snapshot_hash text;

CREATE OR REPLACE FUNCTION public.compute_letter_snapshot_chained_hash()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  prev_hash text;
  payload text;
BEGIN
  -- Only compute on insert; never let chained_hash mutate
  IF TG_OP = 'INSERT' THEN
    SELECT chained_hash INTO prev_hash
    FROM public.comment_letter_snapshots
    WHERE plan_review_id = NEW.plan_review_id
      AND id <> NEW.id
    ORDER BY created_at DESC, sent_at DESC
    LIMIT 1;

    NEW.previous_snapshot_hash := prev_hash;

    payload := COALESCE(prev_hash, '') || '|'
            || NEW.plan_review_id::text || '|'
            || COALESCE(NEW.round::text, '1') || '|'
            || COALESCE(NEW.letter_html_sha256, encode(digest(COALESCE(NEW.letter_html, ''), 'sha256'), 'hex')) || '|'
            || COALESCE(NEW.pdf_sha256, '') || '|'
            || COALESCE(NEW.sent_by::text, '') || '|'
            || COALESCE(NEW.sent_at::text, now()::text);

    NEW.chained_hash := encode(digest(payload, 'sha256'), 'hex');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_letter_snapshot_chained_hash ON public.comment_letter_snapshots;
CREATE TRIGGER tr_letter_snapshot_chained_hash
  BEFORE INSERT ON public.comment_letter_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.compute_letter_snapshot_chained_hash();

-- Backfill existing snapshots in chronological order per plan_review
DO $$
DECLARE
  rec RECORD;
  prev_hash text;
  current_pr uuid := NULL;
  payload text;
  computed text;
BEGIN
  FOR rec IN
    SELECT id, plan_review_id, round, letter_html, letter_html_sha256, pdf_sha256, sent_by, sent_at, created_at
    FROM public.comment_letter_snapshots
    WHERE chained_hash IS NULL
    ORDER BY plan_review_id, created_at, sent_at
  LOOP
    IF current_pr IS DISTINCT FROM rec.plan_review_id THEN
      current_pr := rec.plan_review_id;
      prev_hash := NULL;
    END IF;

    payload := COALESCE(prev_hash, '') || '|'
            || rec.plan_review_id::text || '|'
            || COALESCE(rec.round::text, '1') || '|'
            || COALESCE(rec.letter_html_sha256, encode(digest(COALESCE(rec.letter_html, ''), 'sha256'), 'hex')) || '|'
            || COALESCE(rec.pdf_sha256, '') || '|'
            || COALESCE(rec.sent_by::text, '') || '|'
            || COALESCE(rec.sent_at::text, rec.created_at::text);

    computed := encode(digest(payload, 'sha256'), 'hex');

    UPDATE public.comment_letter_snapshots
    SET previous_snapshot_hash = prev_hash,
        chained_hash = computed
    WHERE id = rec.id;

    prev_hash := computed;
  END LOOP;
END $$;

-- 5) E&O insurance fields on firm_settings (F.S. 553.791(20)) --------------
ALTER TABLE public.firm_settings
  ADD COLUMN IF NOT EXISTS eo_carrier text,
  ADD COLUMN IF NOT EXISTS eo_policy_number text,
  ADD COLUMN IF NOT EXISTS eo_coverage_amount numeric,
  ADD COLUMN IF NOT EXISTS eo_expires_on date;
