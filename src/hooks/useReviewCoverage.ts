import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Returns the sheet-coverage percentage (0-100) for a plan review, or null
 * if no review_coverage row exists yet (pipeline hasn't recorded it).
 *
 * Used by LetterReadinessGate to enforce the firm-level coverage gate
 * (block letter when coverage < 100%).
 */
export function useReviewCoveragePct(planReviewId: string | undefined) {
  return useQuery({
    queryKey: ["review-coverage-pct", planReviewId],
    queryFn: async () => {
      if (!planReviewId) return null;
      const { data, error } = await supabase
        .from("review_coverage")
        .select("sheets_reviewed, sheets_total")
        .eq("plan_review_id", planReviewId)
        .maybeSingle();
      if (error) throw error;
      if (!data || !data.sheets_total) return null;
      return Math.min(100, Math.round((data.sheets_reviewed / data.sheets_total) * 100));
    },
    enabled: !!planReviewId,
  });
}
