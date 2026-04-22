-- Clear stale pipeline state for the two stuck reviews so the next run is clean.
-- Both were polluted by failed runs (Proper Pizza: empty file registry; Oxford Dr:
-- raw PDF sent to Gemini vision, producing fake sheet_coverage and an empty DNA row).
DELETE FROM public.sheet_coverage
WHERE plan_review_id = 'f14d3a8a-b81c-476d-a481-0fbf9c7055c3';

DELETE FROM public.project_dna
WHERE plan_review_id = 'f14d3a8a-b81c-476d-a481-0fbf9c7055c3';

DELETE FROM public.review_pipeline_status
WHERE plan_review_id IN (
  'f14d3a8a-b81c-476d-a481-0fbf9c7055c3',
  'eb8df5a0-4ea7-4782-ae06-eefff366c827'
);