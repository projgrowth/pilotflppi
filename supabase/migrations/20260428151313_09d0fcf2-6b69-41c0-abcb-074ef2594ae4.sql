-- Sprint 1 schema additions for statutory compliance.

-- 1. Per-round Notice to Building Official + Plan Compliance Affidavit timestamps.
ALTER TABLE public.plan_reviews
  ADD COLUMN IF NOT EXISTS notice_to_building_official_filed_at timestamptz,
  ADD COLUMN IF NOT EXISTS compliance_affidavit_signed_at timestamptz;

-- 2. Multi-pause clock history. Each entry: { paused_at, resumed_at|null, reason, note, actor }.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS clock_pause_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS clock_pause_reason text;

-- 3. Per-discipline professional licenses for the reviewer of record.
-- Shape: { architectural: "AR12345", structural: "PE67890", ... }
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS discipline_licenses jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Helpful index for "who can sign for X discipline" queries.
CREATE INDEX IF NOT EXISTS idx_profiles_discipline_licenses
  ON public.profiles USING gin (discipline_licenses);
