
-- Add jurisdictions jsonb column to firm_settings
ALTER TABLE public.firm_settings
ADD COLUMN jurisdictions jsonb DEFAULT '[]'::jsonb;

-- Add optional contractor_id FK to permit_leads
ALTER TABLE public.permit_leads
ADD COLUMN contractor_id uuid REFERENCES public.contractors(id) ON DELETE SET NULL;
