REVOKE EXECUTE ON FUNCTION public.merge_review_progress(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.merge_review_progress(uuid, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.merge_review_progress(uuid, jsonb) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.merge_review_progress(uuid, jsonb) TO service_role;