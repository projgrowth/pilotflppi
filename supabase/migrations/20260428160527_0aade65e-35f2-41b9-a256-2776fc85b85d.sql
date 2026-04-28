-- Sprint 3 P2: chain-of-custody (PDF hashing) + cross-round defect lineage.

-- 1. Hashing on uploaded plan files. Nullable so legacy rows aren't broken;
--    new uploads will populate both columns.
ALTER TABLE public.plan_review_files
  ADD COLUMN IF NOT EXISTS pdf_sha256 text,
  ADD COLUMN IF NOT EXISTS file_size_bytes bigint;

CREATE INDEX IF NOT EXISTS idx_plan_review_files_sha256
  ON public.plan_review_files (pdf_sha256)
  WHERE pdf_sha256 IS NOT NULL;

-- 2. Hashing on snapshot PDF artifact for "this is exactly what we sent" proofs.
ALTER TABLE public.comment_letter_snapshots
  ADD COLUMN IF NOT EXISTS pdf_sha256 text,
  ADD COLUMN IF NOT EXISTS letter_html_sha256 text;

-- 3. Cross-round defect lineage. lineage_id stays stable across rounds so the
--    UI can render "Round 1 → Round 2 → still open in Round 3" trails.
--    Defaults to gen_random_uuid() so first-round findings get their own
--    lineage automatically; carryover logic in dedupe will reuse the prior
--    round's lineage_id when a near-match is detected.
ALTER TABLE public.deficiencies_v2
  ADD COLUMN IF NOT EXISTS lineage_id uuid DEFAULT gen_random_uuid();

UPDATE public.deficiencies_v2
   SET lineage_id = gen_random_uuid()
 WHERE lineage_id IS NULL;

ALTER TABLE public.deficiencies_v2
  ALTER COLUMN lineage_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_deficiencies_v2_lineage
  ON public.deficiencies_v2 (lineage_id);

CREATE INDEX IF NOT EXISTS idx_deficiencies_v2_pr_lineage
  ON public.deficiencies_v2 (plan_review_id, lineage_id);
