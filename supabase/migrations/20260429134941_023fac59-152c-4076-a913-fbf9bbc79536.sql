-- Lock down Wave 6 functions: trigger functions don't need to be callable
-- as RPCs, and the pipeline lock helper is only for the edge function
-- (which uses the service role).
REVOKE EXECUTE ON FUNCTION public.assert_clock_pause_invariant() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.stamp_reviewer_disposition_at() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.try_acquire_pipeline_lock(uuid) FROM authenticated;