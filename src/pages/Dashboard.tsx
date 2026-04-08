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
  FolderKanban,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Plus,
  CalendarPlus,
  Sparkles,
  Radar,
  ChevronRight,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useNavigate } from "react-router-dom";

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

  const recentProjects = (projects || []).slice(0, 5);

  const kpis = [
    { label: "Active Projects", value: stats?.activeProjects ?? "—", icon: FolderKanban, color: "text-teal", path: "/projects" },
    { label: "Critical Deadlines", value: stats?.criticalDeadlines ?? "—", icon: AlertTriangle, color: (stats?.criticalDeadlines ?? 0) > 0 ? "text-destructive" : "text-muted-foreground", path: "/deadlines" },
    { label: "Avg Review Time", value: stats?.avgReviewTime ?? "—", icon: Clock, color: "text-accent", path: "/plan-review" },
    { label: "Completed MTD", value: stats?.completedMTD ?? "—", icon: CheckCircle2, color: "text-success", path: "/projects" },
  ];

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

      {/* Quick Actions — horizontal */}
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

      {/* KPI cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <Card
            key={kpi.label}
            className="shadow-subtle border hover:shadow-md transition-all duration-150 cursor-pointer active:scale-[0.98]"
            onClick={() => navigate(kpi.path)}
          >
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{kpi.label}</p>
                <kpi.icon className={`h-4 w-4 ${kpi.color}`} />
              </div>
              {statsLoading ? (
                <div className="h-9 w-16 rounded bg-muted animate-pulse" />
              ) : (
                <p className="text-3xl font-semibold tracking-tight">{kpi.value}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent Projects */}
      <div className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Recent Projects</h2>
          <Button variant="ghost" size="sm" className="text-xs text-accent" onClick={() => navigate("/projects")}>
            View all →
          </Button>
        </div>
        <Card className="shadow-subtle border">
          {projectsLoading ? (
            <div className="divide-y">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-3.5">
                  <div className="h-11 w-11 rounded-full bg-muted animate-pulse" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-40 rounded bg-muted animate-pulse" />
                    <div className="h-3 w-56 rounded bg-muted animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : recentProjects.length === 0 ? (
            <EmptyState
              icon={FolderKanban}
              title="No projects yet"
              description="Create your first project to get started"
              actionLabel="Create Project"
              onAction={() => navigate("/projects?action=new")}
            />
          ) : (
            <div className="divide-y">
              {/* Column headers */}
              <div className="hidden md:grid grid-cols-[44px_1fr_80px_80px_120px_80px_20px] gap-4 px-5 py-2 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                <span />
                <span>Project</span>
                <span>Trade</span>
                <span>County</span>
                <span>Status</span>
                <span>Timeline</span>
                <span />
              </div>
              {recentProjects.map((project) => {
                const daysElapsed = getDaysElapsed(project.notice_filed_at);
                return (
                  <div
                    key={project.id}
                    onClick={() => navigate(`/projects/${project.id}`)}
                    className="list-row"
                  >
                    <DeadlineRing daysElapsed={daysElapsed} size={44} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{project.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{project.address}</p>
                    </div>
                    <span className="hidden sm:inline-flex rounded bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground capitalize">
                      {project.trade_type}
                    </span>
                    <span className="hidden md:inline text-xs text-muted-foreground">{project.county}</span>
                    <StatusChip status={project.status} />
                    <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                      Day {daysElapsed}/21
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Activity Feed — full width */}
      <div>
        <h2 className="mb-3 text-xs font-semibold text-muted-foreground uppercase tracking-widest">Activity Feed</h2>
        <Card className="shadow-subtle border">
          <CardContent className="p-0 divide-y">
            {activityLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-start gap-3 px-5 py-3.5">
                  <div className="mt-1.5 h-2 w-2 rounded-full bg-muted animate-pulse" />
                  <div className="flex-1 space-y-1">
                    <div className="h-4 w-full rounded bg-muted animate-pulse" />
                    <div className="h-3 w-20 rounded bg-muted animate-pulse" />
                  </div>
                </div>
              ))
            ) : (activity || []).length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">No recent activity</div>
            ) : (
              (activity || []).map((item) => (
                <div key={item.id} className="flex items-start gap-3 px-5 py-3.5">
                  <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${getEventColor(item.event_type)}`} />
                  <div className="flex-1">
                    <p className="text-sm">{item.description}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
