ALTER TABLE public.pipeline_error_log
  ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'error';

UPDATE public.pipeline_error_log
   SET severity = 'info'
 WHERE severity = 'error'
   AND error_class IN ('cost_metric','chunk_summary','chunk_resume','storage_cleanup','rasterize_partial');

UPDATE public.pipeline_error_log
   SET severity = 'warn'
 WHERE severity = 'error'
   AND error_class IN ('soft_timeout','stuck_no_progress','dispatch_failed','needs_browser_rasterization');

CREATE INDEX IF NOT EXISTS idx_pipeline_error_log_severity_created
  ON public.pipeline_error_log (severity, created_at DESC);