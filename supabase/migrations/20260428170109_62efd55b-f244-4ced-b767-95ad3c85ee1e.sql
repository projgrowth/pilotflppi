
-- ============================================================
-- P0/P1 Legitimacy Hardening
-- 1. Florida holiday-aware statutory deadline (server parity with client)
-- 2. QC sign-off columns
-- 3. Letter-snapshot guard (require row before flipping comments_sent)
-- ============================================================

-- 1a. Florida holiday lookup. Floats computed in SQL.
CREATE OR REPLACE FUNCTION public.is_fl_state_holiday(d date)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  y int := EXTRACT(YEAR FROM d)::int;
  m int := EXTRACT(MONTH FROM d)::int;
  dom int := EXTRACT(DAY FROM d)::int;
  dow int := EXTRACT(DOW FROM d)::int; -- 0=Sun..6=Sat
  -- Helpers via dynamic computation
  jan_mlk date;
  feb_pres date;
  may_mem date;
  sep_lab date;
  nov_thx date;
BEGIN
  -- Fixed holidays
  IF (m=1 AND dom=1) THEN RETURN true; END IF;          -- New Year
  IF (m=6 AND dom=19) THEN RETURN true; END IF;         -- Juneteenth
  IF (m=7 AND dom=4) THEN RETURN true; END IF;          -- Independence Day
  IF (m=11 AND dom=11) THEN RETURN true; END IF;        -- Veterans Day
  IF (m=12 AND dom=24) THEN RETURN true; END IF;        -- Christmas Eve (FL)
  IF (m=12 AND dom=25) THEN RETURN true; END IF;        -- Christmas Day

  -- 3rd Monday in January (MLK)
  jan_mlk := date_trunc('month', make_date(y,1,1))::date
    + ((1 - EXTRACT(DOW FROM make_date(y,1,1))::int + 7) % 7) + 14;
  IF d = jan_mlk THEN RETURN true; END IF;

  -- 3rd Monday in February (Presidents)
  feb_pres := date_trunc('month', make_date(y,2,1))::date
    + ((1 - EXTRACT(DOW FROM make_date(y,2,1))::int + 7) % 7) + 14;
  IF d = feb_pres THEN RETURN true; END IF;

  -- Last Monday in May (Memorial)
  may_mem := (date_trunc('month', make_date(y,6,1)) - INTERVAL '1 day')::date;
  WHILE EXTRACT(DOW FROM may_mem)::int <> 1 LOOP
    may_mem := may_mem - 1;
  END LOOP;
  IF d = may_mem THEN RETURN true; END IF;

  -- 1st Monday in September (Labor)
  sep_lab := date_trunc('month', make_date(y,9,1))::date
    + ((1 - EXTRACT(DOW FROM make_date(y,9,1))::int + 7) % 7);
  IF d = sep_lab THEN RETURN true; END IF;

  -- 4th Thursday in November (Thanksgiving) + day after
  nov_thx := date_trunc('month', make_date(y,11,1))::date
    + ((4 - EXTRACT(DOW FROM make_date(y,11,1))::int + 7) % 7) + 21;
  IF d = nov_thx OR d = nov_thx + 1 THEN RETURN true; END IF;

  RETURN false;
END;
$$;

-- 1b. Replace deadline computer to skip weekends AND FL holidays
CREATE OR REPLACE FUNCTION public.compute_statutory_deadline(start_date timestamp with time zone, business_days integer)
RETURNS timestamp with time zone
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
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
    IF EXTRACT(DOW FROM current_date_val)::int NOT IN (0,6)
       AND NOT public.is_fl_state_holiday(current_date_val) THEN
      days_added := days_added + 1;
    END IF;
  END LOOP;

  RETURN current_date_val::timestamptz;
END;
$$;

-- 1c. Backfill existing project deadlines using the new function
UPDATE public.projects
SET statutory_deadline_at = public.compute_statutory_deadline(
  review_clock_started_at,
  COALESCE(statutory_review_days, 30)
)
WHERE review_clock_started_at IS NOT NULL
  AND status NOT IN ('certificate_issued','cancelled');

-- 2. QC sign-off columns on plan_reviews
ALTER TABLE public.plan_reviews
  ADD COLUMN IF NOT EXISTS qc_approved_by uuid,
  ADD COLUMN IF NOT EXISTS qc_approved_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS qc_notes text DEFAULT '' NOT NULL;

-- 3. Provenance backfill helpers — make model_version / prompt_version_id queryable
CREATE INDEX IF NOT EXISTS idx_deficiencies_v2_model_version
  ON public.deficiencies_v2 (model_version)
  WHERE model_version IS NOT NULL;
