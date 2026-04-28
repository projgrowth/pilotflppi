-- Vector embeddings for canonical FBC code sections (Tier 2.3 grounder)
ALTER TABLE public.fbc_code_sections
  ADD COLUMN IF NOT EXISTS embedding_vector vector(1536),
  ADD COLUMN IF NOT EXISTS embedded_at timestamptz;

CREATE INDEX IF NOT EXISTS fbc_code_sections_embedding_idx
  ON public.fbc_code_sections
  USING hnsw (embedding_vector vector_cosine_ops);

CREATE OR REPLACE FUNCTION public.match_fbc_code_sections(
  query_vector vector,
  match_threshold double precision DEFAULT 0.55,
  match_count integer DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  code text,
  section text,
  edition text,
  title text,
  requirement_text text,
  similarity double precision
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT
    s.id, s.code, s.section, s.edition, s.title, s.requirement_text,
    1 - (s.embedding_vector <=> query_vector) AS similarity
  FROM public.fbc_code_sections s
  WHERE s.embedding_vector IS NOT NULL
    AND 1 - (s.embedding_vector <=> query_vector) > match_threshold
  ORDER BY s.embedding_vector <=> query_vector
  LIMIT match_count;
$$;