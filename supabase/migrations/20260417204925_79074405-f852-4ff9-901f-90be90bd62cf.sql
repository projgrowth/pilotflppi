-- Tighten storage policies on the 'documents' bucket.
-- Replace open authenticated-any-path policies with path-prefix-scoped policies
-- so files must live under a known prefix (projects/ or plan-reviews/) AND
-- only authenticated users can touch them.

DROP POLICY IF EXISTS "Authenticated users can read documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete documents" ON storage.objects;

-- READ: authenticated users can read project & plan-review documents
CREATE POLICY "Authenticated can read project documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'documents'
  AND (
    (storage.foldername(name))[1] = 'projects'
    OR (storage.foldername(name))[1] = 'plan-reviews'
  )
);

-- INSERT: authenticated users can upload only under known prefixes
CREATE POLICY "Authenticated can upload project documents"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'documents'
  AND (
    (storage.foldername(name))[1] = 'projects'
    OR (storage.foldername(name))[1] = 'plan-reviews'
  )
);

-- UPDATE: same constraint
CREATE POLICY "Authenticated can update project documents"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'documents'
  AND (
    (storage.foldername(name))[1] = 'projects'
    OR (storage.foldername(name))[1] = 'plan-reviews'
  )
);

-- DELETE: only admins can delete (prevents accidental destruction by any reviewer)
CREATE POLICY "Admins can delete project documents"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'documents'
  AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
  )
);