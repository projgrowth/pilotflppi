
-- Remove anon storage policies on documents bucket
DROP POLICY IF EXISTS "Anon users can upload to documents" ON storage.objects;
DROP POLICY IF EXISTS "Anon users can read documents" ON storage.objects;
DROP POLICY IF EXISTS "Public can read documents" ON storage.objects;
