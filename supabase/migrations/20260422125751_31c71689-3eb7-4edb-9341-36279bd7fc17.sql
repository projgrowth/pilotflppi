-- Enable realtime streaming for deficiencies_v2 + deferred_scope_items
ALTER TABLE public.deficiencies_v2 REPLICA IDENTITY FULL;
ALTER TABLE public.deferred_scope_items REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.deficiencies_v2;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.deferred_scope_items;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;