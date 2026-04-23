import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// pipeline_error_log isn't in generated types yet — narrow cast for reads.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db: any = supabase;

export interface CostMetricRow {
  id: string;
  stage: string;
  metadata: {
    model?: string;
    ms?: number;
    input_tokens?: number | null;
    output_tokens?: number | null;
    total_tokens?: number | null;
    discipline?: string | null;
    chunk?: string | null;
    has_tool?: boolean;
  } | null;
  created_at: string;
}

export interface StageCostSummary {
  stage: string;
  calls: number;
  totalMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  avgMs: number;
}

/**
 * Per-stage cost & timing rollup over the last N days.
 *
 * Reads cost_metric rows from pipeline_error_log (emitted by callAI in
 * run-review-pipeline). 90-day retention is handled by the cron added in
 * round 6, so this query is bounded.
 */
export function usePipelineCostMetrics(days = 7) {
  return useQuery({
    queryKey: ["pipeline_cost_metrics", days],
    queryFn: async (): Promise<StageCostSummary[]> => {
      const since = new Date(Date.now() - days * 86400 * 1000).toISOString();
      const { data, error } = await db
        .from("pipeline_error_log")
        .select("stage, metadata, created_at")
        .eq("error_class", "cost_metric")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw error;

      const rows = (data ?? []) as CostMetricRow[];
      const byStage = new Map<string, StageCostSummary>();
      for (const r of rows) {
        const m = r.metadata ?? {};
        const cur = byStage.get(r.stage) ?? {
          stage: r.stage,
          calls: 0,
          totalMs: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          avgMs: 0,
        };
        cur.calls += 1;
        cur.totalMs += typeof m.ms === "number" ? m.ms : 0;
        cur.totalInputTokens += typeof m.input_tokens === "number" ? m.input_tokens : 0;
        cur.totalOutputTokens += typeof m.output_tokens === "number" ? m.output_tokens : 0;
        byStage.set(r.stage, cur);
      }

      const out = Array.from(byStage.values()).map((s) => ({
        ...s,
        avgMs: s.calls > 0 ? Math.round(s.totalMs / s.calls) : 0,
      }));
      // Sort by total token spend descending — most expensive stages first.
      out.sort(
        (a, b) =>
          b.totalInputTokens + b.totalOutputTokens -
          (a.totalInputTokens + a.totalOutputTokens),
      );
      return out;
    },
    staleTime: 60_000,
  });
}
