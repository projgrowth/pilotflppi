import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/StatusChip";
import { DeadlineRing } from "@/components/DeadlineRing";
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
import { format } from "date-fns";

const mockKPIs = [
  { label: "Active Projects", value: 12, icon: FolderKanban, color: "text-teal" },
  { label: "Critical Deadlines", value: 3, icon: AlertTriangle, color: "text-destructive" },
  { label: "Avg Review Time", value: "4.2d", icon: Clock, color: "text-accent" },
  { label: "Completed MTD", value: 8, icon: CheckCircle2, color: "text-success" },
];

const mockProjects = [
  { id: "1", name: "Oceanview Tower", address: "1200 Ocean Dr, Miami Beach", trade: "Structural", county: "Miami-Dade", status: "plan_review" as const, daysElapsed: 6 },
  { id: "2", name: "Palm Gardens Condo", address: "450 Palm Ave, Fort Lauderdale", trade: "Electrical", county: "Broward", status: "inspection" as const, daysElapsed: 16 },
  { id: "3", name: "Sunrise Medical Center", address: "800 Sunrise Blvd, Tampa", trade: "Mechanical", county: "Hillsborough", status: "comments_sent" as const, daysElapsed: 19 },
  { id: "4", name: "Harbor Point Retail", address: "325 Harbor Rd, Jacksonville", trade: "Plumbing", county: "Duval", status: "intake" as const, daysElapsed: 2 },
];

const mockBriefing = [
  { color: "bg-destructive", message: "Sunrise Medical Center: Day 19 — only 2 days remain. Expedite review.", time: "8 min ago" },
  { color: "bg-warning", message: "Palm Gardens Condo: Contractor uploaded revised plans for Round 2.", time: "22 min ago" },
  { color: "bg-success", message: "Bay Tower project marked complete. Certificate issued.", time: "1 hr ago" },
  { color: "bg-teal", message: "New permit lead detected: 9500 Collins Ave, $4.2M estimated.", time: "2 hrs ago" },
];

export default function Dashboard() {
  const { user } = useAuth();
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const displayName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "there";

  return (
    <div className="p-6 md:p-8 max-w-7xl">
      {/* Greeting */}
      <div className="mb-8">
        <h1 className="text-2xl font-medium text-foreground">
          {greeting}, {displayName}.
        </h1>
        <p className="text-sm text-muted-foreground">{format(now, "EEEE, MMMM d, yyyy")}</p>
      </div>

      {/* KPI cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {mockKPIs.map((kpi) => (
          <Card key={kpi.label} className="shadow-subtle border">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-muted-foreground">{kpi.label}</p>
                <kpi.icon className={`h-4 w-4 ${kpi.color}`} />
              </div>
              <p className="text-3xl font-semibold tracking-tight">{kpi.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent Projects */}
      <div className="mb-8">
        <h2 className="mb-4 text-sm font-semibold text-muted-foreground uppercase tracking-wide">Recent Projects</h2>
        <Card className="shadow-subtle border divide-y">
          {mockProjects.map((project) => (
            <div key={project.id} className="flex items-center gap-4 px-5 py-3 hover:bg-muted/30 transition-colors cursor-pointer">
              <DeadlineRing daysElapsed={project.daysElapsed} size={44} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{project.name}</p>
                <p className="text-xs text-muted-foreground truncate">{project.address}</p>
              </div>
              <span className="hidden sm:inline-flex rounded bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {project.trade}
              </span>
              <span className="hidden md:inline text-xs text-muted-foreground">{project.county}</span>
              <StatusChip status={project.status} />
              <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                Day {project.daysElapsed}/21
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
            </div>
          ))}
        </Card>
      </div>

      {/* Bottom split */}
      <div className="grid gap-6 lg:grid-cols-5">
        {/* AI Briefing */}
        <div className="lg:col-span-3">
          <h2 className="mb-4 text-sm font-semibold text-muted-foreground uppercase tracking-wide">AI Briefing</h2>
          <Card className="shadow-subtle border">
            <CardContent className="p-0 divide-y">
              {mockBriefing.map((item, i) => (
                <div key={i} className="flex items-start gap-3 px-5 py-3">
                  <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.color}`} />
                  <div className="flex-1">
                    <p className="text-sm">{item.message}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{item.time}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <div className="lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold text-muted-foreground uppercase tracking-wide">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "New Intake", icon: Plus, variant: "default" as const },
              { label: "Schedule Inspection", icon: CalendarPlus, variant: "outline" as const },
              { label: "Run AI Check", icon: Sparkles, variant: "outline" as const },
              { label: "Find Leads", icon: Radar, variant: "outline" as const },
            ].map((action) => (
              <Button
                key={action.label}
                variant={action.variant}
                className={action.variant === "default" ? "bg-accent text-accent-foreground hover:bg-accent/90 h-auto py-4 flex-col gap-2" : "h-auto py-4 flex-col gap-2"}
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
