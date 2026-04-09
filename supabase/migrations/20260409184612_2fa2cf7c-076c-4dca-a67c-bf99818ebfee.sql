-- Add inspection clock tracking column
ALTER TABLE public.projects 
ADD COLUMN IF NOT EXISTS inspection_clock_started_at timestamptz;

-- Add FBC edition field to plan_reviews
ALTER TABLE public.plan_reviews 
ADD COLUMN IF NOT EXISTS fbc_edition text;

-- Add checklist_state to plan_reviews for persistent checklists
ALTER TABLE public.plan_reviews 
ADD COLUMN IF NOT EXISTS checklist_state jsonb DEFAULT '{}'::jsonb;

-- Create trigger function to auto-pause/resume clock on status changes
CREATE OR REPLACE FUNCTION public.auto_manage_statutory_clock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Auto-pause clock when comments are sent
  IF NEW.status = 'comments_sent' AND OLD.status IS DISTINCT FROM 'comments_sent' THEN
    NEW.review_clock_paused_at := now();
  END IF;

  -- Resume clock when resubmitted
  IF NEW.status = 'resubmitted' AND OLD.status IS DISTINCT FROM 'resubmitted' THEN
    NEW.review_clock_paused_at := NULL;
    -- If clock wasn't started yet, start it now
    IF NEW.review_clock_started_at IS NULL THEN
      NEW.review_clock_started_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_manage_statutory_clock
BEFORE UPDATE ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.auto_manage_statutory_clock();

-- Create trigger function to set inspection clock when inspection is scheduled
CREATE OR REPLACE FUNCTION public.set_inspection_clock_on_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- When a new inspection is created, set the inspection clock if not already set
  UPDATE public.projects
  SET inspection_clock_started_at = COALESCE(inspection_clock_started_at, now()),
      updated_at = now()
  WHERE id = NEW.project_id
    AND inspection_clock_started_at IS NULL;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_inspection_clock
AFTER INSERT ON public.inspections
FOR EACH ROW
EXECUTE FUNCTION public.set_inspection_clock_on_schedule();