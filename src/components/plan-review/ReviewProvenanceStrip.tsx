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
import { CheckCircle2, AlertCircle, Eye, FileSearch, BookOpen, Layers, Gauge } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface QualityBreakdown {
  verified_citations_pct?: number;
  verified_findings_pct?: number;
  with_evidence_crop_pct?: number;
  has_hallucinated_citations?: boolean;
  total_live_findings?: number;
}

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
  const qualityScore =
    typeof progress?.quality_score === "number"
      ? (progress.quality_score as number)
      : null;
  const qualityBreakdown =
    (progress?.quality_breakdown as QualityBreakdown | undefined) ?? null;
  if (!hasHealth && !hasDna && !submittalIncomplete && qualityScore === null) {
    return null;
  }

  const total = health?.total ?? 0;
  const grounded = health?.grounded ?? 0;
  const needsEyes = health?.needsEyes ?? 0;
  const libraryGap = health?.citationsLibraryGap ?? 0;
  const merged = health?.mergedDuplicates ?? 0;
  const groundedPct = pct(grounded, total);
  const dnaMissing = Array.isArray(dna?.missing_fields) ? dna.missing_fields.length : 0;
  const dnaPresent = Math.max(0, DNA_FIELD_TOTAL - dnaMissing);

  const qualityTone =
    qualityScore === null
      ? "text-muted-foreground"
      : qualityScore >= 80
        ? "text-success"
        : qualityScore >= 60
          ? "text-warning"
          : "text-destructive";

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
          {libraryGap > 0 && (
            <span
              className="flex items-center gap-1 text-muted-foreground"
              title="Citation points to a real FBC chapter we don't carry verbatim text for yet — finding still valid, citation just not double-checked."
            >
              <BookOpen className="h-3 w-3" />
              <strong>{libraryGap}</strong> code lookup unavailable
            </span>
          )}
          {needsEyes > 0 && (
            <span
              className="flex items-center gap-1 text-warning"
              title="Findings the AI flagged as requiring human review before sending."
            >
              <Eye className="h-3 w-3" />
              <strong>{needsEyes}</strong> need review
            </span>
          )}
          {merged > 0 && (
            <span
              className="flex items-center gap-1 text-muted-foreground"
              title="Duplicate findings auto-merged so the reviewer reads one comment instead of N."
            >
              <Layers className="h-3 w-3" />
              <strong>{merged}</strong> merged
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
