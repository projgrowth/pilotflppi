ALTER TABLE public.project_dna
  ADD COLUMN IF NOT EXISTS occupant_load integer,
  ADD COLUMN IF NOT EXISTS is_coastal boolean;

COMMENT ON COLUMN public.project_dna.occupant_load IS
  'F.S. 553.79(5)(b) threshold input — total designed occupant load for assembly occupancies. NULL = not extracted; threshold-building logic falls back to advisory.';
COMMENT ON COLUMN public.project_dna.is_coastal IS
  'Audit M-04: true when project sits on barrier island / WBDR / coastal flood zone, even if the county is generally inland (e.g. Hillsborough Tampa Bay frontage). Drives WBDR + flood callouts.';