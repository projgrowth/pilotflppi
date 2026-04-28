import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useFirmId } from "@/hooks/useFirmId";
import { subscribeShared } from "@/hooks/useReviewDashboard";

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
 * Returns every plan review with at least one pipeline row in the last 24h
 * OR a currently active stage. RLS scopes rows to the user's firm.
 *
 * Realtime is the source of freshness — we share one channel per firm via
 * `subscribeShared` so multiple components mounting this hook don't trigger
 * Supabase Realtime's "cannot add postgres_changes after subscribe()" error.
 * No polling — realtime is reliable for this table.
 */
export function useAllActivePipelines() {
  const qc = useQueryClient();
  const { firmId } = useFirmId();

  const query = useQuery({
    queryKey: ["pipeline-activity-all", firmId],
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
        .in("id", reviewIds)
        .is("deleted_at", null);

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
    // Short-circuit until firm membership resolves — prevents subscribing
    // with a placeholder firm id and prevents an empty initial fetch.
    enabled: !!firmId,
  });

  // Single shared channel per firm. ref-counted in useReviewDashboard so
  // mounting this hook in multiple components is safe.
  useEffect(() => {
    if (!firmId) return;
    return subscribeShared(
      `pipeline-activity-all:${firmId}`,
      "review_pipeline_status",
      `firm_id=eq.${firmId}`,
      () => {
        qc.invalidateQueries({ queryKey: ["pipeline-activity-all", firmId] });
      },
    );
  }, [firmId, qc]);

  return query;
}

/** Compact count of pipelines with running/pending rows, for sidebar badge. */
export function useActivePipelineCount(): number {
  const { data } = useAllActivePipelines();
  return (data ?? []).filter((a) => a.hasActive).length;
}
