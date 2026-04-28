-- Soft-delete + lifecycle columns for projects, plan_reviews, plan_review_files.
-- Existing list queries will be updated to filter `deleted_at IS NULL`.
ALTER TABLE public.projects             ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.projects             ADD COLUMN IF NOT EXISTS deleted_by uuid;
ALTER TABLE public.projects             ADD COLUMN IF NOT EXISTS delete_reason text;

ALTER TABLE public.plan_reviews         ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.plan_reviews         ADD COLUMN IF NOT EXISTS deleted_by uuid;
ALTER TABLE public.plan_reviews         ADD COLUMN IF NOT EXISTS delete_reason text;

ALTER TABLE public.plan_review_files    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.plan_review_files    ADD COLUMN IF NOT EXISTS deleted_by uuid;

CREATE INDEX IF NOT EXISTS idx_projects_deleted_at          ON public.projects (deleted_at);
CREATE INDEX IF NOT EXISTS idx_plan_reviews_deleted_at      ON public.plan_reviews (deleted_at);
CREATE INDEX IF NOT EXISTS idx_plan_review_files_deleted_at ON public.plan_review_files (deleted_at);

-- Precision tracking for findings (used by future challenger + round-diff stages,
-- and surfaced now in the workspace badges).
ALTER TABLE public.deficiencies_v2 ADD COLUMN IF NOT EXISTS verified_by_challenger boolean NOT NULL DEFAULT false;
ALTER TABLE public.deficiencies_v2 ADD COLUMN IF NOT EXISTS round_diff_status text
  CHECK (round_diff_status IS NULL OR round_diff_status IN ('new','resolved','unresolved','partially_resolved'));

-- Per-firm gating preferences for the comment-letter readiness checks.
ALTER TABLE public.firm_settings ADD COLUMN IF NOT EXISTS block_letter_on_low_coverage boolean NOT NULL DEFAULT true;
ALTER TABLE public.firm_settings ADD COLUMN IF NOT EXISTS block_letter_on_ungrounded   boolean NOT NULL DEFAULT true;
ALTER TABLE public.firm_settings ADD COLUMN IF NOT EXISTS block_review_on_incomplete_submittal boolean NOT NULL DEFAULT false;