import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { subscribeShared } from "@/hooks/useReviewDashboard";

// pipeline_error_log isn't in generated types yet — narrow cast for reads.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db: any = supabase;

export interface PipelineErrorRow {
  id: string;
  plan_review_id: string;
  firm_id: string | null;
  stage: string;
  error_class: string;
  error_message: string;
  attempt_count: number;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/**
 * All recent pipeline errors for the active firm. Used by the Pipeline
 * Activity Errors tab. Defaults to the last 24h.
 *
 * Filters by `severity in ('warn','error')` so cost metrics and progress
 * markers (info) don't drown out real failures.
 */
export function useRecentPipelineErrors(hours = 24) {
  return useQuery({
    queryKey: ["pipeline_errors_recent", hours],
    queryFn: async () => {
      const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
      const { data, error } = await db
        .from("pipeline_error_log")
        .select("*")
        .gte("created_at", since)
        .in("severity", ["warn", "error"])
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as PipelineErrorRow[];
    },
  });
}

/** Subscribe to pipeline errors for one review — used to surface error toasts. */
export function usePipelineErrorStream(
  planReviewId: string | undefined,
  onError: (row: PipelineErrorRow) => void,
) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!planReviewId) return;
    const cleanup = subscribeShared(
      `pipeline-errors-${planReviewId}`,
      "pipeline_error_log",
      `plan_review_id=eq.${planReviewId}`,
      () => {
        // Realtime fired — fetch the latest single row to deliver to onError.
        void (async () => {
          const { data } = await db
            .from("pipeline_error_log")
            .select("*")
            .eq("plan_review_id", planReviewId)
            .order("created_at", { ascending: false })
            .limit(1);
          const row = (data?.[0] ?? null) as PipelineErrorRow | null;
          if (row) onError(row);
          qc.invalidateQueries({ queryKey: ["pipeline_errors_recent"] });
        })();
      },
    );
    return cleanup;
  }, [planReviewId, qc, onError]);
}
