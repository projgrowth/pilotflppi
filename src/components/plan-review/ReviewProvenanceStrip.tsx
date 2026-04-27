/**
 * One-line "trust receipt" rendered above the findings list.
 *
 * Tells the reviewer at a glance how much of the AI's output is grounded
 * in canonical evidence vs. needs human eyes. Pulls from existing data:
 *
 *   - useReviewHealth() → grounded / needs-eyes / total counts
 *   - project_dna.missing_fields → DNA coverage
 *   - ai_run_progress.submittal_incomplete → submittal status
 *
 * No extra writes. No new tables.
 */
import { useReviewHealth, pct } from "@/hooks/useReviewHealth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, AlertCircle, Eye, FileSearch, BookOpen, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  planReviewId: string;
  /** From `plan_reviews.ai_run_progress` — used to surface submittal status. */
  progress: Record<string, unknown> | null | undefined;
}

const DNA_FIELD_TOTAL = 14; // matches the DNA schema field count

export function ReviewProvenanceStrip({ planReviewId, progress }: Props) {
  const healthMap = useReviewHealth([planReviewId]);
  const health = healthMap[planReviewId];

  // DNA coverage — single small query, cached.
  const { data: dna } = useQuery({
    queryKey: ["plan-review-dna", planReviewId],
    enabled: !!planReviewId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_dna")
        .select("missing_fields, ambiguous_fields")
        .eq("plan_review_id", planReviewId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Don't render the strip until at least one signal is available.
  const hasHealth = !!health && health.total > 0;
  const hasDna = !!dna;
  const submittalIncomplete = progress?.submittal_incomplete === true;
  if (!hasHealth && !hasDna && !submittalIncomplete) return null;

  const total = health?.total ?? 0;
  const grounded = health?.grounded ?? 0;
  const needsEyes = health?.needsEyes ?? 0;
  const groundedPct = pct(grounded, total);
  const dnaMissing = Array.isArray(dna?.missing_fields) ? dna.missing_fields.length : 0;
  const dnaPresent = Math.max(0, DNA_FIELD_TOTAL - dnaMissing);

  return (
    <div className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 flex items-center gap-3 text-2xs flex-wrap">
      {hasHealth && (
        <>
          <span className="font-mono text-foreground/80">
            <strong>{total}</strong> findings
          </span>
          <span
            className={cn(
              "flex items-center gap-1",
              groundedPct !== null && groundedPct >= 80
                ? "text-success"
                : "text-muted-foreground",
            )}
            title="Findings whose FBC citation was matched against the canonical code text."
          >
            <CheckCircle2 className="h-3 w-3" />
            <strong>{grounded}</strong> grounded
            {groundedPct !== null && (
              <span className="opacity-60">({groundedPct}%)</span>
            )}
          </span>
          {needsEyes > 0 && (
            <span
              className="flex items-center gap-1 text-warning"
              title="Findings the AI flagged as requiring human review before sending."
            >
              <Eye className="h-3 w-3" />
              <strong>{needsEyes}</strong> need review
            </span>
          )}
        </>
      )}
      {hasDna && (
        <span
          className={cn(
            "flex items-center gap-1",
            dnaMissing === 0 ? "text-foreground/80" : "text-muted-foreground",
          )}
          title="Project DNA fields read from the cover / code-summary sheets."
        >
          <FileSearch className="h-3 w-3" />
          DNA <strong>{dnaPresent}/{DNA_FIELD_TOTAL}</strong>
        </span>
      )}
      {submittalIncomplete && (
        <span className="flex items-center gap-1 text-warning ml-auto" title="Required trades missing from this submittal.">
          <AlertCircle className="h-3 w-3" />
          Submittal: <strong>incomplete</strong>
        </span>
      )}
    </div>
  );
}
