-- 1. Extend fbc_code_sections
ALTER TABLE public.fbc_code_sections
  ADD COLUMN IF NOT EXISTS code_family text NOT NULL DEFAULT 'building';

DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.fbc_code_sections'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%code%'
  LOOP
    EXECUTE format('ALTER TABLE public.fbc_code_sections DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;

ALTER TABLE public.fbc_code_sections
  ADD CONSTRAINT fbc_code_sections_code_check
  CHECK (code IN (
    'FBC','FBC-B','FBC-R','FBC-EC','FBC-M','FBC-P','FBC-FG','FBC-EX',
    'FBC-A','FBC-E','FBC-EB',
    'NEC','NFPA1','NFPA101','FFPC','FAC','ASCE-7'
  ));

ALTER TABLE public.fbc_code_sections
  ADD CONSTRAINT fbc_code_sections_family_check
  CHECK (code_family IN ('building','fire','accessibility','energy','mechanical','plumbing','electrical','structural','other'));

-- Backfill family for existing rows
UPDATE public.fbc_code_sections SET code_family = CASE
  WHEN code IN ('NFPA1','NFPA101','FFPC') THEN 'fire'
  WHEN code = 'FBC-A' THEN 'accessibility'
  WHEN code = 'FBC-EC' THEN 'energy'
  WHEN code = 'FBC-M' THEN 'mechanical'
  WHEN code = 'FBC-P' THEN 'plumbing'
  WHEN code IN ('FBC-E','NEC') THEN 'electrical'
  WHEN code = 'ASCE-7' THEN 'structural'
  WHEN code = 'FAC' THEN 'accessibility'
  ELSE 'building'
END
WHERE code_family = 'building';

CREATE INDEX IF NOT EXISTS idx_fbc_code_sections_family ON public.fbc_code_sections(code_family);

-- 2. Threshold building / Special Inspector fields on plan_reviews
ALTER TABLE public.plan_reviews
  ADD COLUMN IF NOT EXISTS special_inspector_designated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS special_inspector_name text,
  ADD COLUMN IF NOT EXISTS special_inspector_license text;
