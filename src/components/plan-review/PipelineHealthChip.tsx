/**
 * PipelineHealthChip — compact health indicator for a project's most recent
 * plan-review pipeline run. Surfaces silent failures (skipped pages, retried
 * stages, hard errors) where reviewers will actually see them: on the
 * project header, not buried in the Pipeline Activity page.
 *
 * Visual states:
 *   - hidden        → no errors in the lookback window (default 24h)
 *   - amber chip    → degraded (retries, soft skips) with tooltip detail
 *   - red chip      → hard failure (stage threw, no recovery)
 *
 * Click → navigates to /pipeline-activity for the full error list.
 */
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, AlertOctagon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// pipeline_error_log isn't in generated types yet — narrow cast for reads.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db: any = supabase;

interface Props {
  /** Project-level: aggregates errors across all plan_reviews of the project. */
  projectId?: string;
  /** Plan-review-level: errors for one specific review only. */
  planReviewId?: string;
  /** Lookback window in hours. Defaults to 48h to catch overnight runs. */
  hours?: number;
  className?: string;
}

interface ErrorRow {
  id: string;
  stage: string;
  error_class: string;
  error_message: string;
  attempt_count: number;
  created_at: string;
  plan_review_id: string;
}

export default function PipelineHealthChip({
  projectId,
  planReviewId,
  hours = 48,
  className,
}: Props) {
  const navigate = useNavigate();

  const { data: errors } = useQuery({
    queryKey: ["pipeline-health", projectId ?? "_", planReviewId ?? "_", hours],
    queryFn: async () => {
      const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
      let ids: string[] = [];
      if (planReviewId) {
        ids = [planReviewId];
      } else if (projectId) {
        const { data: prs } = await supabase
          .from("plan_reviews")
          .select("id")
          .eq("project_id", projectId)
          .is("deleted_at", null);
        ids = (prs ?? []).map((p) => p.id);
      }
      if (ids.length === 0) return [] as ErrorRow[];
      const { data, error } = await db
        .from("pipeline_error_log")
        .select("id, stage, error_class, error_message, attempt_count, created_at, plan_review_id")
        .in("plan_review_id", ids)
        .in("severity", ["warn", "error"])
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as ErrorRow[];
    },
    enabled: !!(projectId || planReviewId),
    staleTime: 30_000,
  });

  const summary = useMemo(() => {
    const rows = errors ?? [];
    if (rows.length === 0) return null;
    // Hard failures: anything not classified as a transient retry. The
    // pipeline marks recoverable cases as `retry`/`soft_skip`; everything
    // else is a real fault that may have produced a degraded letter.
    const hard = rows.filter(
      (r) => !/retry|soft_skip|rate_limit/i.test(r.error_class),
    );
    const stages = new Set(rows.map((r) => r.stage));
    return {
      total: rows.length,
      hardCount: hard.length,
      stages: [...stages],
      latest: rows[0],
    };
  }, [errors]);

  if (!summary) return null;

  const isHard = summary.hardCount > 0;
  const Icon = isHard ? AlertOctagon : AlertTriangle;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => navigate("/pipeline-activity")}
            className={cn(
              "inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition-colors",
              isHard
                ? "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15"
                : "border-warning/40 bg-warning/10 text-warning hover:bg-warning/15",
              className,
            )}
          >
            <Icon className="h-3 w-3" />
            {isHard ? "Pipeline error" : "Degraded run"}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-1 text-xs">
            <div className="font-semibold">
              {summary.total} pipeline event{summary.total === 1 ? "" : "s"} in last {hours}h
            </div>
            <div className="text-muted-foreground">
              Affected stages: {summary.stages.join(", ")}
            </div>
            {summary.latest && (
              <div className="border-t border-border/50 pt-1">
                <span className="font-mono">[{summary.latest.stage}]</span>{" "}
                {summary.latest.error_message.slice(0, 140)}
                {summary.latest.error_message.length > 140 ? "…" : ""}
              </div>
            )}
            <div className="text-muted-foreground italic">
              Click to open Pipeline Activity
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
