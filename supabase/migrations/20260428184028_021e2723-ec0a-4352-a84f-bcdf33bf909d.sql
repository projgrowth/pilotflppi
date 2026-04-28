-- Daily cleanup cron for orphaned uploads & noisy logs.
-- Runs every day at 07:00 UTC (≈ 3am ET) and invokes the existing
-- cleanup-orphan-uploads edge function.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Drop any prior schedule with the same name so this migration is idempotent.
DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-orphan-uploads-daily')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-orphan-uploads-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'cleanup-orphan-uploads-daily',
  '0 7 * * *',
  $$
  SELECT net.http_post(
    url := 'https://iisgxjneamwbehipgcmg.supabase.co/functions/v1/cleanup-orphan-uploads',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{"scheduled":true}'::jsonb
  ) AS request_id;
  $$
);