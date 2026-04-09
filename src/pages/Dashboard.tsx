import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/StatusChip";
import { DeadlineRing } from "@/components/DeadlineRing";
import { EmptyState } from "@/components/EmptyState";
import { KpiCard } from "@/components/KpiCard";
import { useProjects, getDaysElapsed } from "@/hooks/useProjects";
import { useDashboardStats } from "@/hooks/useDashboardStats";
import { useActivityLog, getEventColor } from "@/hooks/useActivityLog";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  FolderKanban, AlertTriangle, Plus, CalendarPlus,
  Sparkles, Radar, ChevronRight, Timer, CheckCircle2, Briefcase, Gavel,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useNavigate } from "react-router-dom";
import { useMemo } from "react";
import { QcPendingWidget } from "@/components/QcPendingWidget";

/* ── Unified project list ── */

function ProjectTable({ projects, navigate }: { projects: any[]; navigate: (path: string) => void }) {
  const rows = useMemo(() => {
    const activeStatuses = ["intake", "plan_review", "comments_sent", "resubmitted", "approved", "permit_issued", "inspection_scheduled"];
    return projects
      .filter((p) => activeStatuses.includes(p.status))
      .map((p) => ({
        ...p,
        daysElapsed: getDaysElapsed(p.notice_filed_at),
        daysRemaining: Math.max(0, 21 - getDaysElapsed(p.notice_filed_at)),
      }))
      .sort((a, b) => a.daysRemaining - b.daysRemaining)
      .slice(0, 8);
  }, [projects]);

  if (rows.length === 0) return null;

  return (
    <Card className="shadow-subtle">
      {/* Header row */}
      <div className="grid grid-cols-[1fr_120px_100px_32px] gap-2 px-5 py-3 border-b text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
        <span>Project</span>
        <span>Status</span>
        <span className="text-right">Deadline</span>
        <span />
      </div>
      <div className="divide-y">
        {rows.map((item) => (
          <div
            key={item.id}
            onClick={() => navigate(`/projects/${item.id}`)}
            className="list-row grid grid-cols-[1fr_120px_100px_32px] gap-2 items-center"
          >
            <div className="flex items-center gap-3 min-w-0">
              <DeadlineRing daysElapsed={item.daysElapsed} size={32} />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{item.name}</p>
                <p className="text-[11px] text-muted-foreground truncate">{item.address}</p>
              </div>
            </div>
            <StatusChip status={item.status} />
            <span className={`font-mono text-xs text-right ${
              item.daysRemaining <= 3 ? "text-destructive font-semibold" :
              item.daysRemaining <= 6 ? "text-[hsl(var(--warning))]" :
              "text-muted-foreground"
            }`}>
              {item.daysRemaining <= 0 ? "Overdue" : `${item.daysRemaining}d left`}
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ── Activity feed with project links ── */

function CompactActivityFeed({ activity, loading, navigate }: { activity: any[]; loading: boolean; navigate: (path: string) => void }) {
  if (loading) {
    return (
      <div className="space-y-3">
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
    return <p className="text-xs text-muted-foreground text-center py-6">No recent activity</p>;
  }

  return (
    <div className="space-y-3">
      {activity.map((item) => (
        <div
          key={item.id}
          className={`flex items-start gap-2 ${item.project_id ? "cursor-pointer hover:bg-muted/30 -mx-1 px-1 rounded transition-colors" : ""}`}
          onClick={() => item.project_id && navigate(`/projects/${item.project_id}`)}
        >
          <div className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${getEventColor(item.event_type)}`} />
          <div className="flex-1">
            <p className="text-xs leading-relaxed">{item.description}</p>
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

  // Overdue projects query
  const { data: overdueProjects } = useQuery({
    queryKey: ["overdue-projects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, deadline_at")
        .lt("deadline_at", new Date().toISOString())
        .not("status", "in", '("certificate_issued","cancelled","on_hold")');
      if (error) throw error;
      return data || [];
    },
  });

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const displayName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "there";

  return (
    <div className="p-8 md:p-10 max-w-7xl">
      {/* Overdue banner */}
      {overdueProjects && overdueProjects.length > 0 && (
        <div className="mb-6 rounded-lg border-l-4 border-l-destructive bg-destructive/5 px-5 py-4 flex items-center gap-4">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 animate-pulse" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-destructive">
              {overdueProjects.length} project{overdueProjects.length > 1 ? "s" : ""} overdue
            </p>
            <p className="text-xs text-destructive/70 mt-0.5">
              {overdueProjects.slice(0, 3).map(p => p.name).join(", ")}
              {overdueProjects.length > 3 ? ` +${overdueProjects.length - 3} more` : ""}
            </p>
          </div>
          <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => navigate("/deadlines")}>
            View
          </Button>
        </div>
      )}

      {/* Compact header: greeting + date on one line */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {greeting}, {displayName}.
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{format(now, "EEEE, MMMM d, yyyy")}</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <KpiCard
          label="Active"
          value={stats?.activeProjects ?? 0}
          icon={Briefcase}
          loading={statsLoading}
          onClick={() => navigate("/projects")}
        />
        <KpiCard
          label="Due This Week"
          value={stats?.criticalDeadlines ?? 0}
          icon={AlertTriangle}
          destructive={(stats?.criticalDeadlines ?? 0) > 0}
          loading={statsLoading}
          onClick={() => navigate("/deadlines")}
        />
        <KpiCard
          label="Statutory Due"
          value={stats?.statutoryDue ?? 0}
          icon={Gavel}
          destructive={(stats?.statutoryDue ?? 0) > 0}
          loading={statsLoading}
          onClick={() => navigate("/deadlines?filter=Statutory")}
        />
        <KpiCard
          label="Completed MTD"
          value={stats?.completedMTD ?? 0}
          icon={CheckCircle2}
          accent
          loading={statsLoading}
        />
        <KpiCard
          label="Avg Review"
          value={stats?.avgReviewTime ?? "0d"}
          icon={Timer}
          loading={statsLoading}
        />
      </div>

      {/* Quick Actions */}
      <div className="mb-8 flex flex-wrap items-center gap-3">
        <Button
          onClick={() => navigate("/projects?action=new")}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4 mr-2" />
          New Intake
        </Button>
        <Button variant="outline" size="sm" onClick={() => navigate("/inspections")}>
          <CalendarPlus className="h-4 w-4 mr-1.5" />
          Schedule Inspection
        </Button>
        <Button variant="outline" size="sm" onClick={() => navigate("/plan-review")}>
          <Sparkles className="h-4 w-4 mr-1.5" />
          Run AI Check
        </Button>
        <Button variant="outline" size="sm" onClick={() => navigate("/lead-radar")}>
          <Radar className="h-4 w-4 mr-1.5" />
          Find Leads
        </Button>
      </div>

      {/* QC Pending Reviews */}
      <div className="mb-8">
        <QcPendingWidget />
      </div>

      {/* Two-column: project table + activity sidebar */}
      <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">All Active Projects</h2>
            <Button variant="ghost" size="sm" className="text-xs text-accent" onClick={() => navigate("/projects")}>
              View all →
            </Button>
          </div>
          {projectsLoading ? (
            <Card className="shadow-subtle">
              <div className="divide-y">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 px-5 py-4">
                    <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
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
            <ProjectTable projects={projects || []} navigate={navigate} />
          )}
        </div>

        {/* Activity sidebar */}
        <div>
          <h2 className="mb-4 text-xs font-semibold text-muted-foreground uppercase tracking-widest">Activity</h2>
          <Card className="shadow-subtle">
            <CardContent className="p-5">
              <CompactActivityFeed activity={activity || []} loading={activityLoading} navigate={navigate} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
