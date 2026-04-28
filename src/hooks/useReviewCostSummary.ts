import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// pipeline_error_log isn't in generated types yet — narrow cast for reads.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db: any = supabase;

interface CostMetricRow {
  metadata: {
    ms?: number;
    input_tokens?: number | null;
    output_tokens?: number | null;
    model?: string;
  } | null;
  created_at: string;
}

export interface ReviewCostSummary {
  /** Total wall-clock-ish AI time, sum of per-call ms. */
  totalMs: number;
  /** Sum of input + output tokens across every AI call this review made. */
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
  /** Rough USD estimate at conservative gateway pricing for Gemini/GPT-5 mix. */
  estimatedUsd: number;
  firstCallAt: string | null;
  lastCallAt: string | null;
}

/**
 * Aggregate AI cost & latency for a single plan review.
 *
 * Reads `pipeline_error_log` rows tagged with `error_class='cost_metric'`
 * (emitted by run-review-pipeline's `recordCostMetric`). Returns null while
 * loading or when nothing has been logged yet.
 *
 * Pricing assumption: $1.25 / M input tokens, $5 / M output tokens —
 * conservative blended estimate that intentionally rounds up so the chip
 * never under-promises spend. Owners can swap models without us re-tuning.
 */
export function useReviewCostSummary(planReviewId?: string) {
  return useQuery<ReviewCostSummary | null>({
    queryKey: ["review_cost_summary", planReviewId],
    enabled: !!planReviewId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await db
        .from("pipeline_error_log")
        .select("metadata, created_at")
        .eq("plan_review_id", planReviewId!)
        .eq("error_class", "cost_metric")
        .order("created_at", { ascending: true })
        .limit(2000);
      if (error) throw error;

      const rows = (data ?? []) as CostMetricRow[];
      if (rows.length === 0) return null;

      let totalMs = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      for (const r of rows) {
        const m = r.metadata ?? {};
        if (typeof m.ms === "number") totalMs += m.ms;
        if (typeof m.input_tokens === "number") inputTokens += m.input_tokens;
        if (typeof m.output_tokens === "number") outputTokens += m.output_tokens;
      }
      const totalTokens = inputTokens + outputTokens;
      const estimatedUsd =
        (inputTokens / 1_000_000) * 1.25 + (outputTokens / 1_000_000) * 5.0;

      return {
        totalMs,
        totalTokens,
        inputTokens,
        outputTokens,
        calls: rows.length,
        estimatedUsd,
        firstCallAt: rows[0]?.created_at ?? null,
        lastCallAt: rows[rows.length - 1]?.created_at ?? null,
      };
    },
  });
}

export function formatCostUsd(usd: number): string {
  if (usd < 0.01) return "<$0.01";
  if (usd < 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  return remSec === 0 ? `${min}m` : `${min}m ${remSec}s`;
}
