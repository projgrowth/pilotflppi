-- Disposition learning loop: embed correction_patterns so the discipline-
-- review prompt can recall semantically related rejections even when the
-- AI cites a different section number than the prior reviewer rejected.
ALTER TABLE public.correction_patterns
  ADD COLUMN IF NOT EXISTS embedding_vector vector(1536),
  ADD COLUMN IF NOT EXISTS embedded_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_correction_patterns_embedding
  ON public.correction_patterns
  USING ivfflat (embedding_vector vector_cosine_ops)
  WITH (lists = 50);

-- Clear stale embeddings when the pattern's text changes.
CREATE OR REPLACE FUNCTION public.clear_pattern_embedding_on_text_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.pattern_summary IS DISTINCT FROM OLD.pattern_summary
     OR NEW.original_finding IS DISTINCT FROM OLD.original_finding
     OR NEW.reason_notes IS DISTINCT FROM OLD.reason_notes THEN
    NEW.embedding_vector := NULL;
    NEW.embedded_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clear_pattern_embedding_on_text_change ON public.correction_patterns;
CREATE TRIGGER clear_pattern_embedding_on_text_change
  BEFORE UPDATE ON public.correction_patterns
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_pattern_embedding_on_text_change();

-- Semantic-match RPC mirroring match_fbc_code_sections.
CREATE OR REPLACE FUNCTION public.match_correction_patterns(
  query_vector vector,
  match_threshold float DEFAULT 0.72,
  match_count int DEFAULT 8,
  p_firm_id uuid DEFAULT NULL,
  p_discipline text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  pattern_summary text,
  original_finding text,
  reason_notes text,
  rejection_count int,
  confirm_count int,
  similarity float
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    cp.id, cp.pattern_summary, cp.original_finding, cp.reason_notes,
    cp.rejection_count, cp.confirm_count,
    1 - (cp.embedding_vector <=> query_vector) AS similarity
  FROM public.correction_patterns cp
  WHERE cp.embedding_vector IS NOT NULL
    AND cp.is_active = true
    AND (p_firm_id IS NULL OR cp.firm_id = p_firm_id)
    AND (p_discipline IS NULL OR cp.discipline = p_discipline)
    AND 1 - (cp.embedding_vector <=> query_vector) > match_threshold
  ORDER BY cp.embedding_vector <=> query_vector
  LIMIT match_count;
$$;

-- Lock down: trigger functions should not be EXECUTEable by clients.
REVOKE EXECUTE ON FUNCTION public.clear_pattern_embedding_on_text_change() FROM anon, authenticated;