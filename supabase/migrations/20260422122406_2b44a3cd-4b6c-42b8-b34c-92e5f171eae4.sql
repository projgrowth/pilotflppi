ALTER TABLE public.deficiencies_v2
  ADD COLUMN IF NOT EXISTS evidence_crop_url text,
  ADD COLUMN IF NOT EXISTS evidence_crop_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.deficiencies_v2.evidence_crop_url IS
  'Optional URL to a cropped PNG of the source PDF region for this finding, used to embed visual evidence in comment letters.';
COMMENT ON COLUMN public.deficiencies_v2.evidence_crop_meta IS
  'Metadata for the evidence crop: { sheet_ref, page_index, evidence_text, bbox: {x,y,w,h}, generated_at }.';