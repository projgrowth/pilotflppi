ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS use_type text;

ALTER TABLE public.projects
DROP CONSTRAINT IF EXISTS projects_use_type_check;

ALTER TABLE public.projects
ADD CONSTRAINT projects_use_type_check
CHECK (use_type IS NULL OR use_type IN ('commercial', 'residential'));