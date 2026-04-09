
-- Add statutory columns to projects
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS statutory_review_days integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS statutory_inspection_days integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS statutory_deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_clock_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_clock_paused_at timestamptz;

-- Create statutory_alerts table
CREATE TABLE IF NOT EXISTS public.statutory_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  alert_type text NOT NULL,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  acknowledged boolean NOT NULL DEFAULT false,
  UNIQUE (project_id, alert_type)
);

ALTER TABLE public.statutory_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read statutory alerts"
  ON public.statutory_alerts FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can update statutory alerts"
  ON public.statutory_alerts FOR UPDATE TO authenticated USING (true);

CREATE POLICY "System can insert statutory alerts"
  ON public.statutory_alerts FOR INSERT TO authenticated WITH CHECK (true);

-- Function: compute business-day deadline from a start date
CREATE OR REPLACE FUNCTION public.compute_statutory_deadline(
  start_date timestamptz,
  business_days integer
)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  current_date_val date := start_date::date;
  days_added integer := 0;
BEGIN
  IF start_date IS NULL OR business_days <= 0 THEN
    RETURN NULL;
  END IF;
  
  WHILE days_added < business_days LOOP
    current_date_val := current_date_val + 1;
    -- Skip weekends (6 = Saturday, 0 = Sunday)
    IF EXTRACT(DOW FROM current_date_val) NOT IN (0, 6) THEN
      days_added := days_added + 1;
    END IF;
  END LOOP;
  
  RETURN current_date_val::timestamptz;
END;
$$;

-- Trigger: reset review clock on new plan_review round
CREATE OR REPLACE FUNCTION public.reset_review_clock_on_resubmission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.projects
  SET review_clock_started_at = now(),
      review_clock_paused_at = NULL,
      statutory_deadline_at = public.compute_statutory_deadline(now(), COALESCE((SELECT statutory_review_days FROM public.projects WHERE id = NEW.project_id), 30)),
      updated_at = now()
  WHERE id = NEW.project_id;
  
  -- Log clock reset
  INSERT INTO public.activity_log (event_type, description, project_id, actor_type, metadata)
  VALUES (
    'statutory_clock_reset',
    'Statutory review clock reset — new review round ' || NEW.round || ' submitted',
    NEW.project_id,
    'system',
    jsonb_build_object('round', NEW.round)
  );
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_reset_review_clock
  AFTER INSERT ON public.plan_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.reset_review_clock_on_resubmission();
