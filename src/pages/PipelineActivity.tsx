import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Activity, AlertTriangle, ExternalLink, Info, Loader2, Play, Square, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import FppEmptyState from "@/components/shared/FppEmptyState";
import { useAllActivePipelines, type ReviewActivity } from "@/hooks/useAllActivePipelines";
import { useReviewHealth, pct, type ReviewHealth } from "@/hooks/useReviewHealth";
import { cancelPipelineForReview, clearOrphanedPipelineRows, resumePipelineForReview } from "@/lib/pipeline-cancel";
import { useFirmId } from "@/hooks/useFirmId";
import { CORE_STAGES, DEEP_STAGES, shortStageLabel } from "@/lib/pipeline-stages";
import { CostTimingPanel } from "@/components/pipeline/CostTimingPanel";
import { cn } from "@/lib/utils";

// formatErrorTime removed — Errors tab uses CostTimingPanel + recent rows surfaced inline.


const shortStage = shortStageLabel;

function elapsed(from: string | null): string {
  if (!from) return "—";
  const ms = Date.now() - new Date(from).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}

function MiniStepper({ activity }: { activity: ReviewActivity }) {
  const stages = activity.mode === "deep" ? DEEP_STAGES : CORE_STAGES;
  const statusByStage = new Map<string, string>();
  for (const r of activity.rows) statusByStage.set(r.stage, r.status);

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
      {stages.map((stage, idx) => {
        const status = statusByStage.get(stage);
        const isCurrent = activity.current?.stage === stage;
        const dotClass = cn(
          "h-2 w-2 rounded-full shrink-0",
          status === "complete" && "bg-primary",
          status === "running" && "bg-primary animate-pulse ring-2 ring-primary/30",
          status === "pending" && "bg-muted-foreground/40",
          status === "error" && "bg-destructive",
          !status && "bg-muted",
        );
        return (
          <div key={stage} className="flex items-center gap-1.5 shrink-0">
            <div className={dotClass} />
            <span
              className={cn(
                "text-[10px] font-mono uppercase tracking-wide",
                isCurrent ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {shortStage(stage)}
            </span>
            {idx < stages.length - 1 && (
              <div className="h-px w-3 bg-border shrink-0" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ActivityRow({
  activity,
  onCancel,
  onResume,
  cancelling,
  resuming,
}: {
  activity: ReviewActivity;
  onCancel: (id: string) => void;
  onResume: (id: string, stage: string) => void;
  cancelling: boolean;
  resuming: boolean;
}) {
  const project = activity.meta?.project;
  const round = activity.meta?.round ?? 1;
  const current = activity.current;
  const canResume =
    activity.isStuck && current?.status === "running" && !!current.stage;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-foreground truncate">
                {project?.name ?? "Untitled project"}
              </h3>
              <span className="text-xs text-muted-foreground font-mono">
                · Round {round}
              </span>
              {activity.mode && (
                <Badge variant="outline" className="text-[10px] uppercase">
                  {activity.mode}
                </Badge>
              )}
              {activity.isStuck && (
                <Badge
                  variant="outline"
                  className="text-[10px] border-orange-500 text-orange-600 dark:text-orange-400"
                >
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Stuck
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {project?.address ?? "—"}
              {project?.county ? ` · ${project.county}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button asChild size="sm" variant="outline">
              <Link to={`/plan-review/${activity.planReviewId}/dashboard`}>
                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                Open
              </Link>
            </Button>
            {canResume && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onResume(activity.planReviewId, current!.stage)}
                disabled={resuming}
              >
                {resuming ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5 mr-1" />
                )}
                Resume
              </Button>
            )}
            <Button
              size="sm"
              variant="destructive"
              onClick={() => onCancel(activity.planReviewId)}
              disabled={!activity.hasActive || cancelling}
            >
              {cancelling ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Square className="h-3.5 w-3.5 mr-1" />
              )}
              Cancel
            </Button>
          </div>
        </div>

        <MiniStepper activity={activity} />

        <div className="flex items-center justify-between text-xs">
          <div className="text-muted-foreground">
            {current ? (
              <>
                Currently:{" "}
                <span className="font-mono text-foreground">
                  {shortStage(current.stage)}
                </span>{" "}
                · {current.status}
                {current.status === "running" && current.started_at && (
                  <> · {elapsed(current.started_at)}</>
                )}
              </>
            ) : (
              "No active stage"
            )}
          </div>
          {activity.isStuck && (
            <span className="text-orange-600 dark:text-orange-400 text-[11px]">
              ⚠ Stuck &gt;2 min — likely safe to cancel
            </span>
          )}
        </div>

        {current?.error_message && (
          <p className="text-[11px] text-destructive font-mono">
            {current.error_message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function PipelineActivity() {
  const { data = [], isLoading } = useAllActivePipelines();
  const { firmId } = useFirmId();
  const qc = useQueryClient();
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancellingAll, setCancellingAll] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [resumingId, setResumingId] = useState<string | null>(null);

  const handleResume = async (planReviewId: string, stage: string) => {
    setResumingId(planReviewId);
    try {
      await resumePipelineForReview(planReviewId, stage);
      toast.success(`Resumed ${stage.replace(/_/g, " ")}`);
      qc.invalidateQueries({ queryKey: ["pipeline-activity-all"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to resume");
    } finally {
      setResumingId(null);
    }
  };

  const active = useMemo(() => data.filter((a) => a.hasActive), [data]);
  const recent = useMemo(() => data.filter((a) => !a.hasActive), [data]);
  const stuckCount = useMemo(
    () => active.filter((a) => a.isStuck).length,
    [active],
  );

  const orphanCount = useMemo(() => {
    const cutoff = Date.now() - 10 * 60 * 1000;
    return data.reduce((acc, a) => {
      return (
        acc +
        a.rows.filter(
          (r) =>
            r.status === "pending" &&
            !r.started_at &&
            new Date(r.updated_at).getTime() < cutoff,
        ).length
      );
    }, 0);
  }, [data]);

  const handleCancel = async (planReviewId: string) => {
    setCancellingId(planReviewId);
    try {
      await cancelPipelineForReview(planReviewId);
      toast.success("Pipeline cancelled");
      qc.invalidateQueries({ queryKey: ["pipeline-activity-all"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to cancel");
    } finally {
      setCancellingId(null);
    }
  };

  const handleCancelAll = async () => {
    if (active.length === 0) return;
    setCancellingAll(true);
    try {
      await Promise.all(
        active.map((a) => cancelPipelineForReview(a.planReviewId)),
      );
      toast.success(`Cancelled ${active.length} pipeline(s)`);
      qc.invalidateQueries({ queryKey: ["pipeline-activity-all"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to cancel all");
    } finally {
      setCancellingAll(false);
    }
  };

  const handleClearOrphans = async () => {
    setClearing(true);
    try {
      const n = await clearOrphanedPipelineRows(firmId);
      toast.success(n > 0 ? `Cleared ${n} orphaned row(s)` : "No orphans to clear");
      qc.invalidateQueries({ queryKey: ["pipeline-activity-all"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to clear orphans");
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-6 md:p-8">
      <PageHeader
        title="Pipeline Activity"
        subtitle="Live view of every running review pipeline across your projects"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-xs">
          <Activity className="h-3 w-3 mr-1" />
          {active.length} active
        </Badge>
        {stuckCount > 0 && (
          <Badge
            variant="outline"
            className="text-xs border-orange-500 text-orange-600 dark:text-orange-400"
          >
            <AlertTriangle className="h-3 w-3 mr-1" />
            {stuckCount} stuck
          </Badge>
        )}
        {orphanCount > 0 && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="text-xs cursor-help gap-1">
                  <Info className="h-3 w-3" />
                  {orphanCount} orphaned pending row(s)
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                Pending stages older than 10 minutes that never started — usually
                from a worker that crashed before claiming the row. Safe to clear.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <div className="flex-1" />
        {orphanCount > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleClearOrphans}
            disabled={clearing}
          >
            {clearing ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5 mr-1" />
            )}
            Clear orphaned
          </Button>
        )}
        {active.length > 0 && (
          <Button
            size="sm"
            variant="destructive"
            onClick={handleCancelAll}
            disabled={cancellingAll}
          >
            {cancellingAll ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <Square className="h-3.5 w-3.5 mr-1" />
            )}
            Cancel all
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-32 rounded-md bg-muted animate-pulse" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <FppEmptyState
          icon={Activity}
          headline="No pipeline activity"
          body="Start a review to see live pipeline progress here."
        />
      ) : (
        <div className="space-y-6">
          <CostTimingPanel />
          {active.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Active now
              </h2>
              {active.map((a) => (
                <ActivityRow
                  key={a.planReviewId}
                  activity={a}
                  onCancel={handleCancel}
                  onResume={handleResume}
                  cancelling={cancellingId === a.planReviewId}
                  resuming={resumingId === a.planReviewId}
                />
              ))}
            </section>
          )}

          {recent.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Recently finished (last 24h)
              </h2>
              {recent.map((a) => (
                <ActivityRow
                  key={a.planReviewId}
                  activity={a}
                  onCancel={handleCancel}
                  onResume={handleResume}
                  cancelling={cancellingId === a.planReviewId}
                  resuming={resumingId === a.planReviewId}
                />
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
