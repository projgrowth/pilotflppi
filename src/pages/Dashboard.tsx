import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { useProjects, getDaysElapsed } from "@/hooks/useProjects";
import { useAllActivePipelines } from "@/hooks/useAllActivePipelines";
import { useFirmId } from "@/hooks/useFirmId";
import { supabase } from "@/integrations/supabase/client";
import { shortStageLabel } from "@/lib/pipeline-stages";
import { Plus, Activity, AlertTriangle, ChevronRight, Clipboard, FileText, Eye } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

/**
 * Focused plan-review dashboard.
 *
 * Replaces the multi-section dashboard (deadlines, AR, AI feed, KPIs) with
 * a single "what should I touch next" board. Statutory clocks, fees, and
 * invoices still live on the project detail and (when extras are enabled)
 * their dedicated pages — they don't need a permanent home on the home
 * screen for a reviewer running the plan-review pipeline.
 *
 * Sections:
 *   1. Active Reviews — every project currently in the pipeline, with the
 *      live stage from review_pipeline_status.
 *   2. Needs My Review — count of findings flagged requires_human_review
 *      across the firm, deep-link into the relevant review.
 */
export default function Dashboard() {
  const navigate = useNavigate();
  const { firmId } = useFirmId();
  const { data: projects, isLoading: projectsLoading } = useProjects();
  const { data: pipelines } = useAllActivePipelines();

  // Map project_id → latest plan_review_id so the dashboard rows can deep-link
  // straight into the review surface (skipping the project detail page).
  const { data: latestReviews } = useQuery({
    queryKey: ["latest-plan-reviews", firmId],
    enabled: !!firmId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plan_reviews")
        .select("id, project_id, round")
        .order("round", { ascending: false });
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const r of data ?? []) {
        if (!map[r.project_id]) map[r.project_id] = r.id;
      }
      return map;
    },
  });

  // Findings flagged for human review across all open reviews. Cheap count
  // query — one bar in the header, expand to the deficiencies page on click.
  const { data: needsReviewCount } = useQuery({
    queryKey: ["needs-human-review-count", firmId],
    enabled: !!firmId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("deficiencies_v2")
        .select("id", { count: "exact", head: true })
        .eq("requires_human_review", true)
        .eq("status", "open");
      if (error) throw error;
      return count ?? 0;
    },
  });

  // Active reviews = projects in any in-pipeline status, joined to their
  // current pipeline stage when one exists.
  const activeRows = useMemo(() => {
    const activeStatuses = new Set([
      "intake",
      "plan_review",
      "comments_sent",
      "resubmitted",
    ]);
    const pipelineByReviewId = new Map(
      (pipelines ?? []).map((p) => [p.planReviewId, p]),
    );
    return (projects ?? [])
      .filter((p) => activeStatuses.has(p.status))
      .map((p) => {
        const reviewId = latestReviews?.[p.id];
        const pipeline = reviewId ? pipelineByReviewId.get(reviewId) : null;
        return {
          project: p,
          reviewId,
          pipeline,
          daysActive: getDaysElapsed(p.notice_filed_at || p.created_at),
        };
      })
      .sort((a, b) => {
        // Active pipelines first, then stuck, then by recency.
        const aActive = a.pipeline?.hasActive ? 1 : 0;
        const bActive = b.pipeline?.hasActive ? 1 : 0;
        if (aActive !== bActive) return bActive - aActive;
        const aStuck = a.pipeline?.isStuck ? 1 : 0;
        const bStuck = b.pipeline?.isStuck ? 1 : 0;
        if (aStuck !== bStuck) return bStuck - aStuck;
        return b.daysActive - a.daysActive;
      });
  }, [projects, pipelines, latestReviews]);

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto space-y-8">
      <PageHeader
        title="Plan Review"
        actions={
          <Button onClick={() => navigate("/projects?new=1")} size="sm">
            <Plus className="h-4 w-4 mr-1.5" />
            New Review
          </Button>
        }
      />

      {/* Needs my review banner */}
      {(needsReviewCount ?? 0) > 0 && (
        <button
          onClick={() => navigate("/review")}
          className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-md border border-warning/30 bg-warning/5 hover:bg-warning/10 transition-colors"
        >
          <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">
              {needsReviewCount} finding{needsReviewCount === 1 ? "" : "s"} flagged
              for human review
            </p>
            <p className="text-xs text-muted-foreground">
              The AI couldn't verify these on its own — review before sending the
              comment letter.
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </button>
      )}

      {/* Active reviews list */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Active Reviews
            {!projectsLoading && (
              <span className="ml-2 text-xs font-normal text-muted-foreground/70">
                ({activeRows.length})
              </span>
            )}
          </h2>
          <Button
            variant="link"
            size="sm"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => navigate("/projects")}
          >
            View all projects →
          </Button>
        </div>

        {projectsLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-20 rounded-md bg-muted/30 animate-pulse"
              />
            ))}
          </div>
        ) : activeRows.length === 0 ? (
          <EmptyState
            icon={Clipboard}
            title="No active reviews"
            description="Upload a plan set to begin your first AI-assisted review."
            actionLabel="Start New Review"
            onAction={() => navigate("/projects?new=1")}
          />
        ) : (
          <Card className="shadow-subtle overflow-hidden divide-y">
            {activeRows.map(({ project, reviewId, pipeline, daysActive }) => (
              <ActiveReviewRow
                key={project.id}
                name={project.name}
                address={project.address}
                jurisdiction={project.jurisdiction || project.county || ""}
                daysActive={daysActive}
                stage={pipeline?.current?.stage ?? null}
                stageStatus={pipeline?.current?.status ?? null}
                isStuck={pipeline?.isStuck ?? false}
                hasActive={pipeline?.hasActive ?? false}
                stageStartedAt={pipeline?.current?.started_at ?? null}
                onClick={() =>
                  navigate(reviewId ? `/plan-review/${reviewId}` : `/review/${project.id}`)
                }
              />
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface ActiveReviewRowProps {
  name: string;
  address: string | null;
  jurisdiction: string;
  daysActive: number;
  stage: string | null;
  stageStatus: string | null;
  isStuck: boolean;
  hasActive: boolean;
  stageStartedAt: string | null;
  onClick: () => void;
}

function ActiveReviewRow({
  name,
  address,
  jurisdiction,
  daysActive,
  stage,
  stageStatus,
  isStuck,
  hasActive,
  stageStartedAt,
  onClick,
}: ActiveReviewRowProps) {
  // Status pill — order: stuck > running > pending > idle.
  const statusPill = (() => {
    if (isStuck) {
      return (
        <Badge variant="outline" className="border-warning/40 text-warning">
          Stuck · {stage ? shortStageLabel(stage) : "pipeline"}
        </Badge>
      );
    }
    if (hasActive && stageStatus === "running") {
      return (
        <Badge className="bg-primary/15 text-primary border-primary/30 hover:bg-primary/15">
          <Activity className="h-3 w-3 mr-1 animate-pulse" />
          {stage ? shortStageLabel(stage) : "running"}
        </Badge>
      );
    }
    if (stage === "complete" || stageStatus === "complete") {
      return (
        <Badge variant="outline" className="border-primary/30 text-primary">
          Ready for letter
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-muted-foreground">
        {stage ? shortStageLabel(stage) : "open"}
      </Badge>
    );
  })();

  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3.5 hover:bg-muted/30 transition-colors flex items-center gap-4"
    >
      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{name}</p>
        <p className="text-xs text-muted-foreground truncate">
          {[jurisdiction, address].filter(Boolean).join(" · ") || "—"}
        </p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span
          className={cn(
            "text-xs tabular-nums font-mono",
            daysActive > 14 ? "text-warning" : "text-muted-foreground",
          )}
        >
          {daysActive}d
        </span>
        {statusPill}
        {stageStartedAt && hasActive && (
          <span className="text-[10px] text-muted-foreground/70 hidden md:inline tabular-nums">
            {formatDistanceToNow(new Date(stageStartedAt), { addSuffix: true })}
          </span>
        )}
        <Eye className="h-3.5 w-3.5 text-muted-foreground/60" />
      </div>
    </button>
  );
}
