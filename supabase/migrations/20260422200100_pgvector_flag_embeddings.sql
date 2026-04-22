-- Upgrade flag_embeddings from keyword text to pgvector (1536-dim cosine similarity).
-- Runs get-similar-corrections via RPC instead of N+1 in-memory Jaccard.
-- Non-destructive: renames old column, adds new one, existing data preserved.

CREATE EXTENSION IF NOT EXISTS vector;

-- Add vector column and timestamp (idempotent).
ALTER TABLE public.flag_embeddings
  ADD COLUMN IF NOT EXISTS embedding_vector vector(1536),
  ADD COLUMN IF NOT EXISTS embedded_at timestamptz;

-- Rename text column for clarity (only if not already renamed).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'flag_embeddings'
      AND column_name  = 'embedding'
  ) THEN
    ALTER TABLE public.flag_embeddings
      RENAME COLUMN embedding TO embedding_keywords;
  END IF;
END $$;

-- IVFFlat index for approximate cosine search.
-- lists=100 suits tables under ~100k rows; bump to 200+ for larger sets.
CREATE INDEX IF NOT EXISTS flag_embeddings_vector_idx
  ON public.flag_embeddings
  USING ivfflat (embedding_vector vector_cosine_ops)
  WITH (lists = 100);

-- RPC function used by get-similar-corrections Edge Function.
-- Returns (correction_id, similarity) pairs above threshold, ordered best-first.
CREATE OR REPLACE FUNCTION public.match_correction_embeddings(
  query_vector    vector(1536),
  match_threshold float   DEFAULT 0.70,
  match_count     integer DEFAULT 10,
  p_firm_id       uuid    DEFAULT NULL
)
RETURNS TABLE (correction_id uuid, similarity float)
LANGUAGE sql STABLE
AS $$
  SELECT
    fe.correction_id,
    1 - (fe.embedding_vector <=> query_vector) AS similarity
  FROM public.flag_embeddings fe
  WHERE fe.embedding_vector IS NOT NULL
    AND 1 - (fe.embedding_vector <=> query_vector) > match_threshold
  ORDER BY fe.embedding_vector <=> query_vector
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_correction_embeddings TO authenticated;

-- Ensure RLS is on (safe to call if already enabled).
ALTER TABLE public.flag_embeddings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth read flag_embeddings"    ON public.flag_embeddings;
DROP POLICY IF EXISTS "Service insert flag_embeddings" ON public.flag_embeddings;
DROP POLICY IF EXISTS "Service update flag_embeddings" ON public.flag_embeddings;

CREATE POLICY "Auth read flag_embeddings"
  ON public.flag_embeddings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service insert flag_embeddings"
  ON public.flag_embeddings FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "Service update flag_embeddings"
  ON public.flag_embeddings FOR UPDATE TO service_role USING (true);
