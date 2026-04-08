import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/StatusChip";
import { DeadlineRing } from "@/components/DeadlineRing";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { useProjects, getDaysElapsed } from "@/hooks/useProjects";
import { useDashboardStats } from "@/hooks/useDashboardStats";
import { useActivityLog, getEventColor } from "@/hooks/useActivityLog";
import {
  FolderKanban, AlertTriangle, Plus, CalendarPlus,
  Sparkles, Radar, ChevronRight, Clock,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useNavigate } from "react-router-dom";
import { useMemo } from "react";

/* ── Sub-components ── */

function InlineStatsBar({ stats, loading }: { stats: any; loading: boolean }) {
  if (loading) return <div className="h-5 w-72 rounded bg-muted animate-pulse" />;
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span><strong className="text-foreground">{stats?.activeProjects ?? 0}</strong> active</span>
      <span className="text-border">·</span>
      <span>
        <strong className={`${(stats?.criticalDeadlines ?? 0) > 0 ? "text-destructive" : "text-foreground"}`}>
          {stats?.criticalDeadlines ?? 0}
        </strong> due this week
      </span>
      <span className="text-border">·</span>
      <span><strong className="text-foreground">{stats?.completedMTD ?? 0}</strong> completed MTD</span>
    </div>
  );
}

function NeedsAttentionQueue({ projects, navigate }: { projects: any[]; navigate: (path: string) => void }) {
  // Items that need action: overdue or nearing deadline, pending reviews
  const urgent = useMemo(() => {
    return projects
      .filter((p) => {
        const days = getDaysElapsed(p.notice_filed_at);
        return (
          days >= 18 ||
          p.status === "plan_review" ||
          p.status === "resubmitted" ||
          p.status === "inspection_scheduled"
        );
      })
      .slice(0, 6)
      .map((p) => {
        const days = getDaysElapsed(p.notice_filed_at);
        let reason = "";
        if (days >= 21) reason = "Overdue";
        else if (days >= 18) reason = `${21 - days}d left`;
        else if (p.status === "plan_review") reason = "Awaiting review";
        else if (p.status === "resubmitted") reason = "Resubmitted";
        else if (p.status === "inspection_scheduled") reason = "Inspection today";
        return { ...p, reason, daysElapsed: days };
      });
  }, [projects]);

  if (urgent.length === 0) {
    return (
      <Card className="shadow-subtle border">
        <CardContent className="py-8 text-center">
          <p className="text-sm text-muted-foreground">Nothing urgent — you're all caught up.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-subtle border">
      <div className="divide-y">
        {urgent.map((item) => (
          <div
            key={item.id}
            onClick={() => navigate(`/projects/${item.id}`)}
            className="list-row"
          >
            <DeadlineRing daysElapsed={item.daysElapsed} size={36} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{item.name}</p>
              <p className="text-xs text-muted-foreground truncate">{item.address}</p>
            </div>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
              item.reason === "Overdue"
                ? "bg-destructive/10 text-destructive"
                : item.reason.includes("left")
                ? "bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))]"
                : "bg-accent/10 text-accent"
            }`}>
              {item.reason}
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
          </div>
        ))}
      </div>
    </Card>
  );
}

function InProgressSection({ projects, navigate }: { projects: any[]; navigate: (path: string) => void }) {
  const inProgress = useMemo(() =>
    projects
      .filter((p) => ["plan_review", "comments_sent", "resubmitted", "inspection_scheduled"].includes(p.status))
      .slice(0, 5),
    [projects]
  );

  if (inProgress.length === 0) return null;

  return (
    <Card className="shadow-subtle border">
      <div className="divide-y">
        {inProgress.map((project) => {
          const daysElapsed = getDaysElapsed(project.notice_filed_at);
          return (
            <div
              key={project.id}
              onClick={() => navigate(`/projects/${project.id}`)}
              className="list-row"
            >
              <DeadlineRing daysElapsed={daysElapsed} size={36} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{project.name}</p>
                <p className="text-xs text-muted-foreground truncate">{project.address}</p>
              </div>
              <StatusChip status={project.status} />
              <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                Day {daysElapsed}/21
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function CompactActivityFeed({ activity, loading }: { activity: any[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="mt-1 h-1.5 w-1.5 rounded-full bg-muted animate-pulse" />
            <div className="flex-1 space-y-1">
              <div className="h-3 w-full rounded bg-muted animate-pulse" />
              <div className="h-2.5 w-16 rounded bg-muted animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!activity || activity.length === 0) {
    return <p className="text-xs text-muted-foreground text-center py-4">No recent activity</p>;
  }

  return (
    <div className="space-y-2.5">
      {activity.map((item) => (
        <div key={item.id} className="flex items-start gap-2">
          <div className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${getEventColor(item.event_type)}`} />
          <div className="flex-1">
            <p className="text-xs leading-snug">{item.description}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Main Dashboard ── */

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: projects, isLoading: projectsLoading } = useProjects();
  const { data: activity, isLoading: activityLoading } = useActivityLog(8);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const displayName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "there";

  const quickActions = [
    { label: "New Intake", icon: Plus, variant: "default" as const, onClick: () => navigate("/projects?action=new") },
    { label: "Schedule Inspection", icon: CalendarPlus, variant: "outline" as const, onClick: () => navigate("/inspections") },
    { label: "Run AI Check", icon: Sparkles, variant: "outline" as const, onClick: () => navigate("/plan-review") },
    { label: "Find Leads", icon: Radar, variant: "outline" as const, onClick: () => navigate("/lead-radar") },
  ];

  return (
    <div className="p-6 md:p-8 max-w-7xl">
      <PageHeader
        title={`${greeting}, ${displayName}.`}
        subtitle={format(now, "EEEE, MMMM d, yyyy")}
      />

      {/* Inline stats bar */}
      <div className="mb-6">
        <InlineStatsBar stats={stats} loading={statsLoading} />
      </div>

      {/* Quick Actions */}
      <div className="mb-8 flex flex-wrap gap-2">
        {quickActions.map((action) => (
          <Button
            key={action.label}
            variant={action.variant}
            onClick={action.onClick}
            size="sm"
            className={action.variant === "default" ? "bg-primary text-primary-foreground hover:bg-primary/90" : ""}
          >
            <action.icon className="h-4 w-4 mr-1.5" />
            {action.label}
          </Button>
        ))}
      </div>

      {/* Two-column: main content + activity sidebar */}
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="space-y-6">
          {/* Needs Attention */}
          <div>
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Needs Attention</h2>
            </div>
            {projectsLoading ? (
              <Card className="shadow-subtle border">
                <div className="divide-y">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4 px-5 py-3.5">
                      <div className="h-9 w-9 rounded-full bg-muted animate-pulse" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 w-40 rounded bg-muted animate-pulse" />
                        <div className="h-3 w-56 rounded bg-muted animate-pulse" />
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            ) : (projects || []).length === 0 ? (
              <EmptyState
                icon={FolderKanban}
                title="No projects yet"
                description="Create your first project to get started"
                actionLabel="Create Project"
                onAction={() => navigate("/projects?action=new")}
              />
            ) : (
              <NeedsAttentionQueue projects={projects || []} navigate={navigate} />
            )}
          </div>

          {/* In Progress */}
          {!projectsLoading && (projects || []).length > 0 && (
            <div>
              <div className="mb-3 flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-accent" />
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">In Progress</h2>
                <Button variant="ghost" size="sm" className="text-xs text-accent ml-auto" onClick={() => navigate("/projects")}>
                  View all →
                </Button>
              </div>
              <InProgressSection projects={projects || []} navigate={navigate} />
            </div>
          )}
        </div>

        {/* Activity sidebar */}
        <div>
          <h2 className="mb-3 text-xs font-semibold text-muted-foreground uppercase tracking-widest">Activity</h2>
          <Card className="shadow-subtle border">
            <CardContent className="p-4">
              <CompactActivityFeed activity={activity || []} loading={activityLoading} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
