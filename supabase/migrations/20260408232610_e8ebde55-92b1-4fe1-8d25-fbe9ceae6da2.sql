
-- 1. Make documents bucket private
UPDATE storage.buckets SET public = false WHERE id = 'documents';

-- 2. Prevent profile role self-escalation: replace UPDATE policy
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;

CREATE POLICY "Users can update own profile without role change"
  ON profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role = (SELECT p.role FROM profiles p WHERE p.id = auth.uid())
  );

-- 3. Scope activity_log INSERT to own actor_id
DROP POLICY IF EXISTS "Authenticated users can insert activity_log" ON activity_log;

CREATE POLICY "Users can only log as themselves"
  ON activity_log FOR INSERT
  TO authenticated
  WITH CHECK (actor_id = auth.uid());
