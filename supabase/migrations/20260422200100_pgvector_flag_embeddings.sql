-- Enable pgvector extension for embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to deficiencies_v2
ALTER TABLE public.deficiencies_v2 ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Create index for similarity search
CREATE INDEX IF NOT EXISTS deficiencies_v2_embedding_idx ON public.deficiencies_v2 USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);