/**
 * Pipeline error subscription — pushes new pipeline_errors rows for a given
 * plan_review_id to a callback as toasts. Used by ReviewDashboard.
 */
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface PipelineErrorRow {
  id: string;
  plan_review_id: string;
  stage: string;
  error_class: string | null;
  error_message: string | null;
  created_at: string;
}

export function usePipelineErrorStream(
  planReviewId: string | undefined,
  onError: (err: PipelineErrorRow) => void,
) {
  const cbRef = useRef(onError);
  cbRef.current = onError;

  useEffect(() => {
    if (!planReviewId) return;
    const channel = supabase
      .channel(`pipeline_errors:${planReviewId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "pipeline_errors",
          filter: `plan_review_id=eq.${planReviewId}`,
        },
        (payload) => {
          cbRef.current(payload.new as PipelineErrorRow);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [planReviewId]);
}
