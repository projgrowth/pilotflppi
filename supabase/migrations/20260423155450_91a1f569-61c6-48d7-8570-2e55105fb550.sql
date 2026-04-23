-- 1) Dedupe existing duplicate (plan_review_id, def_number) rows.
--    Keep the earliest (smallest created_at, smallest id as tiebreaker), drop the rest.
--    These duplicates came from the retry race the new unique index will prevent.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY plan_review_id, def_number
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.deficiencies_v2
)
DELETE FROM public.deficiencies_v2 d
USING ranked r
WHERE d.id = r.id
  AND r.rn > 1;

-- 2) Now safe to add the uniqueness rule.
CREATE UNIQUE INDEX IF NOT EXISTS deficiencies_v2_review_def_uniq
  ON public.deficiencies_v2 (plan_review_id, def_number);

-- 3) Lookup index for the signed-URL cache reads.
CREATE INDEX IF NOT EXISTS plan_review_page_assets_review_page_idx
  ON public.plan_review_page_assets (plan_review_id, page_index);

-- 4) prompt_versions uniqueness so the seed is idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS prompt_versions_key_version_uniq
  ON public.prompt_versions (prompt_key, version);

-- 5) Seed v1 prompt_versions rows (idempotent).
INSERT INTO public.prompt_versions (prompt_key, version, system_prompt, is_active, notes)
VALUES
  ('Architectural',          1, 'discipline-expert:architectural@v1',  true, 'Initial seed — see discipline-experts.ts'),
  ('Structural',             1, 'discipline-expert:structural@v1',     true, 'Initial seed — see discipline-experts.ts'),
  ('Mechanical',             1, 'discipline-expert:mechanical@v1',     true, 'Initial seed — see discipline-experts.ts'),
  ('Electrical',             1, 'discipline-expert:electrical@v1',     true, 'Initial seed — see discipline-experts.ts'),
  ('Plumbing',               1, 'discipline-expert:plumbing@v1',       true, 'Initial seed — see discipline-experts.ts'),
  ('Fire Protection',        1, 'discipline-expert:fire@v1',           true, 'Initial seed — see discipline-experts.ts'),
  ('Civil',                  1, 'discipline-expert:civil@v1',          true, 'Initial seed — see discipline-experts.ts'),
  ('Landscape',              1, 'discipline-expert:landscape@v1',      true, 'Initial seed — see discipline-experts.ts'),
  ('Accessibility',          1, 'discipline-expert:accessibility@v1',  true, 'Initial seed — see discipline-experts.ts'),
  ('General',                1, 'discipline-expert:general@v1',        true, 'Initial seed — see discipline-experts.ts'),
  ('cross_sheet_consistency',1, 'cross-sheet-consistency@v1',          true, 'Initial seed — cross-sheet check'),
  ('verify',                 1, 'verify-findings@v1',                  true, 'Initial seed — verify stage')
ON CONFLICT (prompt_key, version) DO NOTHING;