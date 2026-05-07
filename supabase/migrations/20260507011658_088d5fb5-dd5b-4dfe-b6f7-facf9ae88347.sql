
-- Add use_type column to scope checklists by project type.
-- NULL means "applies to all use types" (back-compat).
ALTER TABLE public.discipline_negative_space
  ADD COLUMN IF NOT EXISTS use_type text;

CREATE INDEX IF NOT EXISTS idx_discipline_negative_space_use_type
  ON public.discipline_negative_space (discipline, use_type)
  WHERE is_active = true;

COMMENT ON COLUMN public.discipline_negative_space.use_type IS
  'Project use_type the checklist row applies to: residential | commercial. NULL = applies to both.';
