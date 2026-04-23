import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useFirmId } from "@/hooks/useFirmId";

export interface PipelineRowRich {
  id: string;
  plan_review_id: string;
  stage: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
  error_message: string | null;
}

export interface PlanReviewMeta {
  id: string;
  round: number;
  ai_run_progress: Record<string, unknown> | null;
  project_id: string;
  project: {
    name: string;
    address: string;
    county: string;
  } | null;
}

export interface ReviewActivity {
  planReviewId: string;
  meta: PlanReviewMeta | null;
  rows: PipelineRowRich[];
  current: PipelineRowRich | null;
  hasActive: boolean;
  isStuck: boolean;
  mode: "core" | "deep" | null;
}

const STUCK_THRESHOLD_MS = 120_000;

/**
 * Returns every plan review that has at least one pipeline row from the last
 * 24 hours OR a currently active stage, plus a live realtime subscription.
 *
 * RLS already scopes rows to the user's firm.
 */
export function useAllActivePipelines() {
  const qc = useQueryClient();
  const { firmId } = useFirmId();

  const query = useQuery({
    queryKey: ["pipeline-activity-all"],
    queryFn: async (): Promise<ReviewActivity[]> => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const { data: rows, error } = await supabase
        .from("review_pipeline_status")
        .select("*")
        .or(`started_at.gte.${since},status.in.(running,pending)`)
        .order("updated_at", { ascending: false });
      if (error) throw error;

      const reviewIds = Array.from(
        new Set((rows ?? []).map((r) => r.plan_review_id)),
      );
      if (reviewIds.length === 0) return [];

      const { data: reviews } = await supabase
        .from("plan_reviews")
        .select(
          "id, round, ai_run_progress, project_id, project:projects(name, address, county)",
        )
        .in("id", reviewIds);

      const metaById = new Map<string, PlanReviewMeta>();
      for (const r of (reviews ?? []) as unknown as PlanReviewMeta[]) {
        metaById.set(r.id, r);
      }

      const grouped = new Map<string, PipelineRowRich[]>();
      for (const row of (rows ?? []) as PipelineRowRich[]) {
        const arr = grouped.get(row.plan_review_id) ?? [];
        arr.push(row);
        grouped.set(row.plan_review_id, arr);
      }

      const activities: ReviewActivity[] = [];
      for (const [planReviewId, list] of grouped) {
        // Newest first by created_at; current = first running, else first pending,
        // else the most recent row.
        const running = list.find((r) => r.status === "running");
        const pending = list.find((r) => r.status === "pending");
        const current = running ?? pending ?? list[0] ?? null;
        const hasActive = !!running || !!pending;
        const isStuck =
          !!running &&
          !!running.started_at &&
          Date.now() - new Date(running.started_at).getTime() >
            STUCK_THRESHOLD_MS;
        const meta = metaById.get(planReviewId) ?? null;
        const progressMode = (meta?.ai_run_progress as { mode?: string } | null)
          ?.mode;
        const mode =
          progressMode === "deep" || progressMode === "core"
            ? progressMode
            : null;

        activities.push({
          planReviewId,
          meta,
          rows: list,
          current,
          hasActive,
          isStuck,
          mode,
        });
      }

      // Active first, then stuck rises to the top within active by oldest start.
      activities.sort((a, b) => {
        if (a.hasActive !== b.hasActive) return a.hasActive ? -1 : 1;
        const aStart = a.current?.started_at
          ? new Date(a.current.started_at).getTime()
          : Number.POSITIVE_INFINITY;
        const bStart = b.current?.started_at
          ? new Date(b.current.started_at).getTime()
          : Number.POSITIVE_INFINITY;
        return aStart - bStart;
      });

      return activities;
    },
    refetchInterval: 5_000,
  });

  // Realtime: invalidate on any change to review_pipeline_status for this firm.
  useEffect(() => {
    if (!firmId) return;
    const channel = supabase
      .channel(`pipeline-activity-all-${firmId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "review_pipeline_status",
          filter: `firm_id=eq.${firmId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["pipeline-activity-all"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [firmId, qc]);

  return query;
}

/** Compact count of pipelines with running/pending rows, for sidebar badge. */
export function useActivePipelineCount(): number {
  const { data } = useAllActivePipelines();
  return (data ?? []).filter((a) => a.hasActive).length;
}
