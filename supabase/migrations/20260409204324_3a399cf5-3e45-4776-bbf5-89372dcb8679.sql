-- Fix: Profile update policy applies to 'public' role (includes unauthenticated)
-- Drop the existing policy and recreate it scoped to 'authenticated' only
DROP POLICY IF EXISTS "Users can update own profile without role change" ON public.profiles;

CREATE POLICY "Users can update own profile without role change"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    (id = auth.uid()) AND (role = (SELECT p.role FROM profiles p WHERE p.id = auth.uid()))
  );