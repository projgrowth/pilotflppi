-- Backfill: auto-waive existing hallucinated findings so historical reviews
-- stop showing fabricated FBC citations as if they were real.
UPDATE public.deficiencies_v2
SET
  status = 'waived',
  reviewer_disposition = 'reject',
  reviewer_notes = COALESCE(NULLIF(reviewer_notes, ''), 'Auto-waived: AI cited a non-parseable FBC section. Un-waive and re-cite manually if this finding is real.'),
  verification_notes = COALESCE(NULLIF(verification_notes, ''), 'Hidden from the comment letter to keep fabricated citations from reaching the AHJ.')
WHERE citation_status = 'hallucinated'
  AND status = 'open';