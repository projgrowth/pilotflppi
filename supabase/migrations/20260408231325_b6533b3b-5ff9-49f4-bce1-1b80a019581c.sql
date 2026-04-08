
-- 1. CONTRACTORS: Remove anon read policy
DROP POLICY IF EXISTS "Anon users can read contractors" ON public.contractors;

-- 2. PLAN_REVIEWS: Remove all anon policies
DROP POLICY IF EXISTS "Anon users can read plan_reviews" ON public.plan_reviews;
DROP POLICY IF EXISTS "Anon users can insert plan_reviews" ON public.plan_reviews;
DROP POLICY IF EXISTS "Anon users can update plan_reviews" ON public.plan_reviews;

-- 3. PROJECTS: Remove anon policies
DROP POLICY IF EXISTS "Anon users can read projects" ON public.projects;
DROP POLICY IF EXISTS "Anon users can insert projects" ON public.projects;

-- 4. ACTIVITY_LOG: Remove anon policies
DROP POLICY IF EXISTS "Anon users can read activity_log" ON public.activity_log;
DROP POLICY IF EXISTS "Anon users can insert activity_log" ON public.activity_log;
