
-- 1. heartbeat column on pipeline status
ALTER TABLE public.review_pipeline_status
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_review_pipeline_status_heartbeat
  ON public.review_pipeline_status (status, heartbeat_at)
  WHERE status = 'running';

-- 2. persisted run mode on plan_reviews
ALTER TABLE public.plan_reviews
  ADD COLUMN IF NOT EXISTS ai_run_mode text;

-- 3. Replace auto_advance_project_status to NOT flip to comments_sent on AI complete.
CREATE OR REPLACE FUNCTION public.auto_advance_project_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  current_status text;
  new_status text := NULL;
BEGIN
  IF TG_TABLE_NAME = 'plan_reviews' THEN
    SELECT status INTO current_status FROM public.projects WHERE id = NEW.project_id;

    IF TG_OP = 'INSERT' THEN
      IF current_status = 'intake' THEN
        new_status := 'plan_review';
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      -- AI completion advances 'intake' -> 'plan_review' (so the project is
      -- visibly "in review"), but it does NOT flip to 'comments_sent'.
      -- That transition now belongs to the comment_letter_snapshots trigger
      -- below, which fires only when a letter is actually dispatched.
      IF NEW.ai_check_status = 'complete'
         AND (OLD.ai_check_status IS DISTINCT FROM 'complete')
         AND current_status = 'intake' THEN
        new_status := 'plan_review';
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

-- 4. New trigger: when a comment letter is INSERTED with sent_at set, flip
-- the project to 'comments_sent'. This is the *real* "letter dispatched"
-- signal, not the AI completing.
CREATE OR REPLACE FUNCTION public.advance_project_on_letter_sent()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  proj_id uuid;
  current_status text;
BEGIN
  IF NEW.sent_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT project_id INTO proj_id
  FROM public.plan_reviews WHERE id = NEW.plan_review_id;

  IF proj_id IS NULL THEN RETURN NEW; END IF;

  SELECT status INTO current_status FROM public.projects WHERE id = proj_id;

  IF current_status IN ('intake', 'plan_review') THEN
    UPDATE public.projects
       SET status = 'comments_sent'::project_status, updated_at = now()
     WHERE id = proj_id;

    INSERT INTO public.activity_log (event_type, description, project_id, actor_type, metadata)
    VALUES (
      'status_auto_advanced',
      'Project status advanced to comments_sent (letter dispatched)',
      proj_id, 'system',
      jsonb_build_object('old_status', current_status, 'new_status', 'comments_sent', 'trigger_table', 'comment_letter_snapshots')
    );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tr_advance_project_on_letter_sent ON public.comment_letter_snapshots;
CREATE TRIGGER tr_advance_project_on_letter_sent
  AFTER INSERT ON public.comment_letter_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.advance_project_on_letter_sent();
