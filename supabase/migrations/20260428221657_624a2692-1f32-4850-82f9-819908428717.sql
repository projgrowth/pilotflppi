-- The match RPC is invoked by edge functions (service role) only — no client
-- needs to run it directly. Lock down EXECUTE to satisfy the security linter.
REVOKE EXECUTE ON FUNCTION public.match_correction_patterns(vector, float, int, uuid, text) FROM anon, authenticated, public;