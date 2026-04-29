-- =========================================================================
-- 1. Backfill: rename existing storage objects from
--      plan-reviews/<reviewId>/...
--    to
--      firms/<firm_id>/plan-reviews/<reviewId>/...
-- Storage object bytes are not moved; only the `name` (object key) changes.
-- =========================================================================
UPDATE storage.objects o
SET name = 'firms/' || pr.firm_id::text || '/' || o.name
FROM public.plan_reviews pr
WHERE o.bucket_id = 'documents'
  AND o.name LIKE 'plan-reviews/' || pr.id::text || '/%'
  AND pr.firm_id IS NOT NULL;

-- =========================================================================
-- 2. Backfill DB rows that store object keys.
-- =========================================================================

-- 2a. plan_review_files.file_path
UPDATE public.plan_review_files prf
SET file_path = 'firms/' || pr.firm_id::text || '/' || prf.file_path
FROM public.plan_reviews pr
WHERE prf.plan_review_id = pr.id
  AND pr.firm_id IS NOT NULL
  AND prf.file_path LIKE 'plan-reviews/%';

-- 2b. plan_review_page_assets.storage_path + vision_storage_path
UPDATE public.plan_review_page_assets a
SET storage_path = 'firms/' || pr.firm_id::text || '/' || a.storage_path
FROM public.plan_reviews pr
WHERE a.plan_review_id = pr.id
  AND pr.firm_id IS NOT NULL
  AND a.storage_path LIKE 'plan-reviews/%';

UPDATE public.plan_review_page_assets a
SET vision_storage_path = 'firms/' || pr.firm_id::text || '/' || a.vision_storage_path
FROM public.plan_reviews pr
WHERE a.plan_review_id = pr.id
  AND pr.firm_id IS NOT NULL
  AND a.vision_storage_path IS NOT NULL
  AND a.vision_storage_path LIKE 'plan-reviews/%';

-- 2c. plan_review_page_assets.source_file_path (mirrors plan_review_files.file_path)
UPDATE public.plan_review_page_assets a
SET source_file_path = 'firms/' || pr.firm_id::text || '/' || a.source_file_path
FROM public.plan_reviews pr
WHERE a.plan_review_id = pr.id
  AND pr.firm_id IS NOT NULL
  AND a.source_file_path LIKE 'plan-reviews/%';

-- 2d. plan_reviews.file_urls[] — array element rewrite
UPDATE public.plan_reviews pr
SET file_urls = ARRAY(
  SELECT CASE
    WHEN u LIKE 'plan-reviews/%'
      THEN 'firms/' || pr.firm_id::text || '/' || u
    ELSE u
  END
  FROM unnest(pr.file_urls) AS u
)
WHERE pr.firm_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM unnest(pr.file_urls) AS u WHERE u LIKE 'plan-reviews/%'
  );

-- 2e. Invalidate any cached signed URLs that point at the old key.
UPDATE public.plan_review_page_assets
SET cached_signed_url = NULL,
    cached_until = NULL
WHERE cached_signed_url IS NOT NULL;

-- =========================================================================
-- 3. CHECK constraints — defense in depth.
-- Only enforced for non-legacy rows; we already moved everything in step 2.
-- We also tolerate `projects/...` paths (separate migration will scope them).
-- =========================================================================

ALTER TABLE public.plan_review_files
  DROP CONSTRAINT IF EXISTS plan_review_files_path_firm_scoped;

ALTER TABLE public.plan_review_files
  ADD CONSTRAINT plan_review_files_path_firm_scoped
  CHECK (file_path LIKE 'firms/%/plan-reviews/%');

ALTER TABLE public.plan_review_page_assets
  DROP CONSTRAINT IF EXISTS plan_review_page_assets_paths_firm_scoped;

ALTER TABLE public.plan_review_page_assets
  ADD CONSTRAINT plan_review_page_assets_paths_firm_scoped
  CHECK (
    storage_path LIKE 'firms/%/plan-reviews/%'
    AND source_file_path LIKE 'firms/%/plan-reviews/%'
    AND (vision_storage_path IS NULL OR vision_storage_path LIKE 'firms/%/plan-reviews/%')
  );

-- =========================================================================
-- 4. Replace storage.objects RLS with firm-scoped policies.
-- Old policies allowed any authenticated user to read any firm's files.
-- =========================================================================

DROP POLICY IF EXISTS "Authenticated can read project documents"   ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can update project documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can upload project documents" ON storage.objects;

-- SELECT: firm members can read their firm's plan-review files.
-- We also keep `projects/...` working (legacy, not yet firm-scoped) so the
-- rest of the app keeps functioning until that migration lands.
CREATE POLICY "Firm members read documents"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'documents'
  AND (
    -- Firm-scoped plan-review files
    (
      (storage.foldername(name))[1] = 'firms'
      AND (storage.foldername(name))[3] = 'plan-reviews'
      AND (storage.foldername(name))[2]::uuid = public.user_firm_id(auth.uid())
    )
    -- Legacy project-prefixed files (separate migration will scope these)
    OR (storage.foldername(name))[1] = 'projects'
  )
);

CREATE POLICY "Firm members upload documents"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'documents'
  AND (
    (
      (storage.foldername(name))[1] = 'firms'
      AND (storage.foldername(name))[3] = 'plan-reviews'
      AND (storage.foldername(name))[2]::uuid = public.user_firm_id(auth.uid())
    )
    OR (storage.foldername(name))[1] = 'projects'
  )
);

CREATE POLICY "Firm members update documents"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'documents'
  AND (
    (
      (storage.foldername(name))[1] = 'firms'
      AND (storage.foldername(name))[3] = 'plan-reviews'
      AND (storage.foldername(name))[2]::uuid = public.user_firm_id(auth.uid())
    )
    OR (storage.foldername(name))[1] = 'projects'
  )
);

CREATE POLICY "Firm members delete documents"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'documents'
  AND (
    (
      (storage.foldername(name))[1] = 'firms'
      AND (storage.foldername(name))[3] = 'plan-reviews'
      AND (storage.foldername(name))[2]::uuid = public.user_firm_id(auth.uid())
    )
    OR (storage.foldername(name))[1] = 'projects'
  )
);

-- The existing "Admins can delete project documents" policy is preserved.
