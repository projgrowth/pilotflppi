
-- Create deadline_alerts table
CREATE TABLE public.deadline_alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('7_day', '3_day', '1_day', 'overdue')),
  triggered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  acknowledged BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (project_id, alert_type)
);

ALTER TABLE public.deadline_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read deadline alerts"
  ON public.deadline_alerts FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can update deadline alerts"
  ON public.deadline_alerts FOR UPDATE TO authenticated USING (true);

-- Add hold_reason to projects
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS hold_reason TEXT DEFAULT NULL;

-- Function to check deadlines and generate alerts
CREATE OR REPLACE FUNCTION public.check_deadline_alerts()
RETURNS void AS $$
DECLARE
  proj RECORD;
  days_remaining INTEGER;
BEGIN
  FOR proj IN
    SELECT id, deadline_at, status, hold_reason
    FROM public.projects
    WHERE deadline_at IS NOT NULL
      AND status NOT IN ('certificate_issued', 'cancelled', 'on_hold')
  LOOP
    days_remaining := EXTRACT(DAY FROM (proj.deadline_at - now()));

    -- Overdue
    IF days_remaining <= 0 THEN
      INSERT INTO public.deadline_alerts (project_id, alert_type)
      VALUES (proj.id, 'overdue')
      ON CONFLICT (project_id, alert_type) DO NOTHING;
      
      -- Auto-hold
      IF proj.hold_reason IS NULL THEN
        UPDATE public.projects
        SET status = 'on_hold', hold_reason = 'Deadline expired — auto-hold', updated_at = now()
        WHERE id = proj.id AND status != 'on_hold';
        
        INSERT INTO public.activity_log (event_type, description, project_id, actor_type, metadata)
        VALUES ('deadline_overdue', 'Project auto-held: deadline expired', proj.id, 'system',
          jsonb_build_object('days_remaining', days_remaining));
      END IF;
    END IF;

    -- 1-day warning
    IF days_remaining <= 1 AND days_remaining > 0 THEN
      INSERT INTO public.deadline_alerts (project_id, alert_type)
      VALUES (proj.id, '1_day')
      ON CONFLICT (project_id, alert_type) DO NOTHING;
    END IF;

    -- 3-day warning
    IF days_remaining <= 3 AND days_remaining > 0 THEN
      INSERT INTO public.deadline_alerts (project_id, alert_type)
      VALUES (proj.id, '3_day')
      ON CONFLICT (project_id, alert_type) DO NOTHING;
    END IF;

    -- 7-day warning
    IF days_remaining <= 7 AND days_remaining > 0 THEN
      INSERT INTO public.deadline_alerts (project_id, alert_type)
      VALUES (proj.id, '7_day')
      ON CONFLICT (project_id, alert_type) DO NOTHING;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
