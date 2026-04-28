
-- 3.4: Auto-clear embedding when canonical text changes.
CREATE OR REPLACE FUNCTION public.clear_fbc_embedding_on_text_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.requirement_text IS DISTINCT FROM OLD.requirement_text
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.keywords IS DISTINCT FROM OLD.keywords THEN
    NEW.embedding_vector := NULL;
    NEW.embedded_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_fbc_embedding ON public.fbc_code_sections;
CREATE TRIGGER trg_clear_fbc_embedding
BEFORE UPDATE ON public.fbc_code_sections
FOR EACH ROW
EXECUTE FUNCTION public.clear_fbc_embedding_on_text_change();

-- 3.3: When a canonical section's text materially changes, flag open
-- findings citing that section for re-grounding by resetting their
-- citation_status to 'unverified'. Reviewers see the existing "Re-ground
-- citations" button and can re-run grounding to pick up the improved text.
CREATE OR REPLACE FUNCTION public.flag_findings_for_reground_on_canonical_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only when requirement_text actually changed AND the new text is non-stub.
  IF NEW.requirement_text IS DISTINCT FROM OLD.requirement_text
     AND length(coalesce(NEW.requirement_text, '')) >= 60
     AND lower(coalesce(NEW.requirement_text, '')) NOT LIKE '%see fbc for full requirement text%' THEN
    UPDATE public.deficiencies_v2 d
       SET citation_status = 'unverified',
           citation_grounded_at = NULL,
           updated_at = now()
     WHERE d.status NOT IN ('resolved', 'waived')
       AND coalesce(d.code_reference->>'section', '') = NEW.section
       AND coalesce(upper(d.code_reference->>'code'), 'FBC') = upper(NEW.code);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_flag_reground_on_canonical_change ON public.fbc_code_sections;
CREATE TRIGGER trg_flag_reground_on_canonical_change
AFTER UPDATE ON public.fbc_code_sections
FOR EACH ROW
EXECUTE FUNCTION public.flag_findings_for_reground_on_canonical_change();
