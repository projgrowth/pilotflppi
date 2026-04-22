-- Enable pgvector extension (idempotent).
CREATE EXTENSION IF NOT EXISTS vector;

-- Add the vector column alongside the existing keyword column.
ALTER TABLE public.flag_embeddings
  ADD COLUMN IF NOT EXISTS embedding_vector vector(1536),
  ADD COLUMN IF NOT EXISTS embedded_at timestamptz;

-- Rename old text column for clarity (keeps data, doesn't break existing reads).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'flag_embeddings'
      AND column_name = 'embedding'
  ) THEN
    ALTER TABLE public.flag_embeddings
      RENAME COLUMN embedding TO embedding_keywords;
  END IF;
END $$;

-- IVFFlat index for approximate nearest-neighbour cosine search.
CREATE INDEX IF NOT EXISTS flag_embeddings_vector_idx
  ON public.flag_embeddings
  USING ivfflat (embedding_vector vector_cosine_ops)
  WITH (lists = 100);

-- Helper function: cosine similarity search used by get-similar-corrections.
CREATE OR REPLACE FUNCTION public.match_correction_embeddings(
  query_vector   vector(1536),
  match_threshold float DEFAULT 0.70,
  match_count     int   DEFAULT 10,
  p_firm_id       uuid  DEFAULT NULL
)
RETURNS TABLE (
  correction_id uuid,
  similarity    float
)
LANGUAGE sql STABLE
SET search_path = public
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