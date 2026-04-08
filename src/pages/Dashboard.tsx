import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/StatusChip";
import { DeadlineRing } from "@/components/DeadlineRing";
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
  Shield,
  MapPin,
  Award,
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
    { label: "Active Projects", value: stats?.activeProjects ?? "—", icon: FolderKanban, color: "text-teal" },
    { label: "Critical Deadlines", value: stats?.criticalDeadlines ?? "—", icon: AlertTriangle, color: (stats?.criticalDeadlines ?? 0) > 0 ? "text-destructive" : "text-muted-foreground" },
    { label: "Avg Review Time", value: stats?.avgReviewTime ?? "—", icon: Clock, color: "text-accent" },
    { label: "Completed MTD", value: stats?.completedMTD ?? "—", icon: CheckCircle2, color: "text-success" },
  ];

  const quickActions = [
    { label: "New Intake", icon: Plus, variant: "default" as const, onClick: () => navigate("/projects?action=new") },
    { label: "Schedule Inspection", icon: CalendarPlus, variant: "outline" as const, onClick: () => navigate("/inspections") },
    { label: "Run AI Check", icon: Sparkles, variant: "outline" as const, onClick: () => navigate("/plan-review") },
    { label: "Find Leads", icon: Radar, variant: "outline" as const, onClick: () => navigate("/lead-radar") },
  ];

  return (
    <div className="p-6 md:p-8 max-w-7xl">
      {/* FPP Stats Bar */}
      <div className="mb-6 flex items-center gap-6 rounded-lg border bg-card px-5 py-3 shadow-subtle">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Shield className="h-3.5 w-3.5 text-primary" />
          <span className="font-mono">AR92053</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Award className="h-3.5 w-3.5 text-accent" />
          <span>44+ Years</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 text-teal" />
          <span>67 Counties</span>
        </div>
      </div>

      <div className="mb-8">
        <h1 className="text-2xl font-medium text-foreground">{greeting}, {displayName}.</h1>
        <p className="text-sm text-muted-foreground">{format(now, "EEEE, MMMM d, yyyy")}</p>
      </div>

      {/* KPI cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label} className="shadow-subtle border hover:shadow-md transition-shadow">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-muted-foreground">{kpi.label}</p>
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
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Recent Projects</h2>
          <Button variant="ghost" size="sm" className="text-xs text-accent" onClick={() => navigate("/projects")}>
            View all →
          </Button>
        </div>
        <Card className="shadow-subtle border divide-y">
          {projectsLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-3">
                <div className="h-11 w-11 rounded-full bg-muted animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-40 rounded bg-muted animate-pulse" />
                  <div className="h-3 w-56 rounded bg-muted animate-pulse" />
                </div>
              </div>
            ))
          ) : recentProjects.length === 0 ? (
            <div className="flex flex-col items-center py-12">
              <FolderKanban className="h-8 w-8 text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">No projects yet</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate("/projects?action=new")}>
                Create your first project
              </Button>
            </div>
          ) : (
            recentProjects.map((project) => {
              const daysElapsed = getDaysElapsed(project.notice_filed_at);
              return (
                <div
                  key={project.id}
                  onClick={() => navigate(`/projects/${project.id}`)}
                  className="flex items-center gap-4 px-5 py-3 hover:bg-muted/30 transition-colors cursor-pointer"
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
            })
          )}
        </Card>
      </div>

      {/* Bottom split */}
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <h2 className="mb-4 text-sm font-semibold text-muted-foreground uppercase tracking-wide">Activity Feed</h2>
          <Card className="shadow-subtle border">
            <CardContent className="p-0 divide-y">
              {activityLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-start gap-3 px-5 py-3">
                    <div className="mt-1.5 h-2 w-2 rounded-full bg-muted animate-pulse" />
                    <div className="flex-1 space-y-1">
                      <div className="h-4 w-full rounded bg-muted animate-pulse" />
                      <div className="h-3 w-20 rounded bg-muted animate-pulse" />
                    </div>
                  </div>
                ))
              ) : (activity || []).length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">No recent activity</div>
              ) : (
                (activity || []).map((item) => (
                  <div key={item.id} className="flex items-start gap-3 px-5 py-3">
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

        <div className="lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold text-muted-foreground uppercase tracking-wide">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-3">
            {quickActions.map((action) => (
              <Button
                key={action.label}
                variant={action.variant}
                onClick={action.onClick}
                className={action.variant === "default" ? "bg-primary text-primary-foreground hover:bg-primary/90 h-auto py-4 flex-col gap-2" : "h-auto py-4 flex-col gap-2"}
              >
                <action.icon className="h-5 w-5" />
                <span className="text-xs">{action.label}</span>
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
