
-- Anon read policies for testing
CREATE POLICY "Anon users can read projects" ON public.projects FOR SELECT TO anon USING (true);
CREATE POLICY "Anon users can read plan_reviews" ON public.plan_reviews FOR SELECT TO anon USING (true);
CREATE POLICY "Anon users can update plan_reviews" ON public.plan_reviews FOR UPDATE TO anon USING (true);
CREATE POLICY "Anon users can read activity_log" ON public.activity_log FOR SELECT TO anon USING (true);
CREATE POLICY "Anon users can insert activity_log" ON public.activity_log FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon users can read contractors" ON public.contractors FOR SELECT TO anon USING (true);

-- Storage policies for anon document access
CREATE POLICY "Anon users can upload to documents" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id = 'documents');
CREATE POLICY "Anon users can read documents" ON storage.objects FOR SELECT TO anon USING (bucket_id = 'documents');
