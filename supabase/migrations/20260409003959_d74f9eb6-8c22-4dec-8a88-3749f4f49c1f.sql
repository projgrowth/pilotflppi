
-- Create plan_review_files table
CREATE TABLE public.plan_review_files (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_review_id UUID NOT NULL REFERENCES public.plan_reviews(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  round INTEGER NOT NULL DEFAULT 1,
  uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  uploaded_by UUID
);

ALTER TABLE public.plan_review_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read plan review files"
  ON public.plan_review_files FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert plan review files"
  ON public.plan_review_files FOR INSERT TO authenticated WITH CHECK (true);

CREATE INDEX idx_plan_review_files_review ON public.plan_review_files(plan_review_id, round);

-- Migrate existing file_urls into plan_review_files
INSERT INTO public.plan_review_files (plan_review_id, file_path, round)
SELECT pr.id, unnest(pr.file_urls), pr.round
FROM public.plan_reviews pr
WHERE array_length(pr.file_urls, 1) > 0;
