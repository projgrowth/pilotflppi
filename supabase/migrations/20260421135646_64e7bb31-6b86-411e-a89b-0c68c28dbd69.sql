ALTER TABLE public.deficiencies_v2
ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'unverified',
ADD COLUMN IF NOT EXISTS verification_notes text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_deficiencies_v2_verification_status
  ON public.deficiencies_v2 (verification_status);