/**
 * Per-review health metrics for the Pipeline Activity page. Computed live from
 * `deficiencies_v2` rows so reviewers can see — at a glance — whether a
 * just-finished pipeline produced trustworthy findings before they open it.
 *
 * Three numbers per review:
 *   - groundedPct  : citations matched against `fbc_code_sections`
 *   - lowConfPct   : findings with confidence_score < 0.4
 *   - needsEyesPct : flagged requires_human_review
 *
 * One bulk query for all reviews on the page; bucketed in memory. Realtime
 * isn't needed — the snapshot updates whenever the parent
 * `useAllActivePipelines` invalidates.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useFirmId } from "@/hooks/useFirmId";

export interface ReviewHealth {
  total: number;
  grounded: number;
  lowConfidence: number;
  needsEyes: number;
}

export interface ReviewHealthMap {
  [planReviewId: string]: ReviewHealth;
}

const LOW_CONFIDENCE_THRESHOLD = 0.4;

export function useReviewHealth(planReviewIds: string[]): ReviewHealthMap {
  const { firmId } = useFirmId();
  // Stable cache key — sorted ids ensure two callers with the same set hit
  // the same query slot.
  const sortedIds = [...planReviewIds].sort();

  const { data } = useQuery({
    queryKey: ["pipeline-review-health", firmId, sortedIds],
    enabled: !!firmId && sortedIds.length > 0,
    // 30s — health doesn't need to be sub-second fresh; the underlying
    // pipeline-activity query is what drives "did this just change".
    staleTime: 30_000,
    queryFn: async (): Promise<ReviewHealthMap> => {
      const { data: rows, error } = await supabase
        .from("deficiencies_v2")
        .select(
          "plan_review_id, citation_status, confidence_score, requires_human_review, verification_status, status",
        )
        .in("plan_review_id", sortedIds);
      if (error) throw error;

      const out: ReviewHealthMap = {};
      for (const id of sortedIds) {
        out[id] = { total: 0, grounded: 0, lowConfidence: 0, needsEyes: 0 };
      }
      for (const r of rows ?? []) {
        // Skip findings that won't appear in the letter — they don't reflect
        // on the run's quality the reviewer actually has to ship.
        if (r.verification_status === "superseded") continue;
        if (r.verification_status === "overturned") continue;
        if (r.status === "resolved" || r.status === "waived") continue;

        const bucket = out[r.plan_review_id];
        if (!bucket) continue;
        bucket.total++;
        if (r.citation_status === "verified") bucket.grounded++;
        if (
          typeof r.confidence_score === "number" &&
          r.confidence_score < LOW_CONFIDENCE_THRESHOLD
        ) {
          bucket.lowConfidence++;
        }
        if (r.requires_human_review) bucket.needsEyes++;
      }
      return out;
    },
  });

  return data ?? {};
}

/** Format `n / total` as a percent integer; returns null when total = 0. */
export function pct(n: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((n / total) * 100);
}
