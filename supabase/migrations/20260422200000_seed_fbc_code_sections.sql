-- Seed FBC code sections for citation grounding
-- This migration inserts ~60 FBC 8th edition sections for the citation database

INSERT INTO public.fbc_code_sections (code, section, edition, title, content) VALUES
-- Add the full list of FBC sections here
-- Example:
('FBC', '101.1', '8th', 'Title', 'Content of the section'),
-- ... more rows
ON CONFLICT (code, section, edition) DO NOTHING;