-- One-time backfill: convert URL-style file_path values to bucket keys.
-- Pattern: https://<host>/storage/v1/object/(public|sign)/documents/<KEY>[?query]
-- Becomes: <KEY> (URL-decoded)
UPDATE public.plan_review_files
SET file_path = (
  SELECT replace(
    -- Strip any trailing query string, then percent-decode.
    -- Postgres lacks a built-in URL decoder, so we handle the common cases
    -- found in our data: %20 (space), %28 / %29 (parens). If a future row
    -- has other escapes the app-side normalizer will still handle it.
    regexp_replace(
      replace(
        replace(
          replace(split_part(captured, '?', 1), '%20', ' '),
          '%28', '('
        ),
        '%29', ')'
      ),
      '%2520', ' '
    ),
    -- safety no-op replace so the SELECT compiles cleanly
    '', ''
  )
  FROM (
    SELECT substring(
      file_path
      FROM '^https?://[^/]+/storage/v1/object/(?:public|sign)/documents/(.+)$'
    ) AS captured
  ) s
)
WHERE file_path ~* '^https?://[^/]+/storage/v1/object/(public|sign)/documents/';