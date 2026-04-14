import { useMemo, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/StatusChip";
import { EmptyState } from "@/components/EmptyState";
import { useProjects, getDaysElapsed } from "@/hooks/useProjects";
import { useReviewFlagCounts } from "@/hooks/useReviewData";
import { useInspections } from "@/hooks/useInspections";
import { useCountUp } from "@/hooks/useCountUp";
import ConfidenceBar from "@/components/shared/ConfidenceBar";
import DaysActiveBadge from "@/components/shared/DaysActiveBadge";
import SkeletonRow from "@/components/shared/SkeletonRow";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useRevenueStats, useInvoices } from "@/hooks/useInvoices";
import {
  FileText, CheckCircle, ClipboardCheck, AlertTriangle,
  Calendar, Zap, Eye, MessageSquare, FileCheck, Clipboard,
  ChevronUp, ChevronDown, Plus, DollarSign, Clock, TrendingUp,
} from "lucide-react";
import { format, formatDistanceToNow, addDays, isToday, isTomorrow, isPast } from "date-fns";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

/* ── KPI Card ── */
function DashKpi({
  icon: Icon, iconColor, label, value, subRow, delay = 0,
}: {
  icon: React.ElementType; iconColor: string; label: string; value: number; subRow?: React.ReactNode; delay?: number;
}) {
  const displayed = useCountUp(value, 800, delay);
  return (
    <Card className="shadow-subtle">
      <CardContent className="p-6 relative">
        <Icon className="absolute top-5 right-5 h-6 w-6" style={{ color: iconColor }} />
        <p className="text-5xl font-bold tracking-tight text-foreground">{displayed}</p>
        <p className="text-[13px] font-medium text-muted-foreground uppercase tracking-widest mt-1">{label}</p>
        {subRow && <p className="text-xs font-mono text-muted-foreground/80 mt-2">{subRow}</p>}
      </CardContent>
    </Card>
  );
}

/* ── Active Reviews Table ── */
type SortKey = "days" | "confidence" | "jurisdiction" | "stage";

function ActiveReviewsQueue({ projects, navigate }: { projects: any[]; navigate: (p: string) => void }) {
  const [sortKey, setSortKey] = useState<SortKey>("days");
  const [sortAsc, setSortAsc] = useState(false);

  const rows = useMemo(() => {
    const activeStatuses = ["intake", "plan_review", "comments_sent", "resubmitted"];
    const filtered = (projects || []).filter((p) => activeStatuses.includes(p.status));
    return filtered
      .map((p) => ({ ...p, daysActive: getDaysElapsed(p.notice_filed_at || p.created_at) }))
      .sort((a, b) => {
        let cmp = 0;
        if (sortKey === "days") cmp = a.daysActive - b.daysActive;
        else if (sortKey === "jurisdiction") cmp = (a.jurisdiction || "").localeCompare(b.jurisdiction || "");
        else if (sortKey === "stage") cmp = (a.status || "").localeCompare(b.status || "");
        return sortAsc ? cmp : -cmp;
      });
  }, [projects, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey === k ? (sortAsc ? <ChevronUp className="h-3 w-3 inline ml-0.5" /> : <ChevronDown className="h-3 w-3 inline ml-0.5" />) : null;

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Clipboard}
        title="No active reviews"
        description="Upload a plan set to begin your first AI-assisted review"
        actionLabel="Start New Review"
        onAction={() => navigate("/review")}
      />
    );
  }

  return (
    <Card className="shadow-subtle overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              <th className="text-left px-4 py-3">Project</th>
              <th className="text-left px-4 py-3 cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("jurisdiction")}>
                Jurisdiction<SortIcon k="jurisdiction" />
              </th>
              <th className="text-left px-4 py-3 cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("stage")}>
                Stage<SortIcon k="stage" />
              </th>
              <th className="text-left px-4 py-3 cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("confidence")}>
                AI Conf.<SortIcon k="confidence" />
              </th>
              <th className="text-left px-4 py-3 cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("days")}>
                Days<SortIcon k="days" />
              </th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.slice(0, 15).map((p) => (
              <tr
                key={p.id}
                className="hover:bg-muted/30 cursor-pointer transition-colors"
                onClick={() => navigate(`/review/${p.id}`)}
              >
                <td className="px-4 py-3">
                  <p className="font-medium truncate max-w-[200px]">{p.name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{p.address}</p>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{p.jurisdiction || p.county || "—"}</td>
                <td className="px-4 py-3"><StatusChip status={p.status} /></td>
                <td className="px-4 py-3"><ConfidenceBar score={0} /></td>
                <td className="px-4 py-3"><DaysActiveBadge days={p.daysActive} /></td>
                <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="View review" onClick={() => navigate(`/review/${p.id}`)}>
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="View project" onClick={() => navigate(`/projects/${p.id}`)}>
                      <MessageSquare className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="View documents" onClick={() => navigate(`/documents`)}>
                      <FileCheck className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ── Upcoming Deadlines Panel ── */
function DeadlinesPanel({ projects, navigate }: { projects: any[]; navigate: (p: string) => void }) {
  const items = useMemo(() => {
    const now = new Date();
    const upcoming = (projects || [])
      .filter((p) => p.deadline_at && !["certificate_issued", "cancelled", "on_hold"].includes(p.status))
      .map((p) => ({ ...p, deadlineDate: new Date(p.deadline_at!) }))
      .filter((p) => p.deadlineDate >= addDays(now, -1) && p.deadlineDate <= addDays(now, 7))
      .sort((a, b) => a.deadlineDate.getTime() - b.deadlineDate.getTime())
      .slice(0, 8);
    return upcoming;
  }, [projects]);

  const getDayLabel = (d: Date) => {
    if (isToday(d)) return "TODAY";
    if (isTomorrow(d)) return "TOMORROW";
    return format(d, "EEE").toUpperCase();
  };

  const getDotColor = (d: Date) => {
    if (isPast(d) && !isToday(d)) return "bg-destructive";
    if (isToday(d)) return "bg-[hsl(var(--warning))]";
    return "bg-accent";
  };

  return (
    <Card className="shadow-subtle">
      <div className="px-5 py-4 border-b flex items-center gap-2">
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <span className="text-[15px] font-semibold text-foreground">Upcoming Deadlines</span>
      </div>
      <CardContent className="p-5">
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">No upcoming deadlines</p>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-3 cursor-pointer hover:bg-muted/30 -mx-2 px-2 py-1 rounded transition-colors"
                onClick={() => navigate(`/projects/${item.id}`)}
              >
                <span className="text-[11px] font-mono text-muted-foreground uppercase w-[70px] pt-0.5 shrink-0">
                  {getDayLabel(item.deadlineDate)}
                </span>
                <div className={cn("mt-1.5 h-2 w-2 rounded-full shrink-0", getDotColor(item.deadlineDate))} />
                <span className="text-[13px] text-foreground">{item.name}</span>
              </div>
            ))}
          </div>
        )}
        <Button variant="link" className="text-accent text-[13px] p-0 mt-3 h-auto" onClick={() => navigate("/deadlines")}>
          View calendar →
        </Button>
      </CardContent>
    </Card>
  );
}

/* ── AI Activity Feed ── */
function AIActivityFeed() {
  const { data: aiOutputs, refetch } = useQuery({
    queryKey: ["ai-activity-feed"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_outputs")
        .select("id, prediction, severity, confidence_score, project_id, created_at")
        .order("created_at", { ascending: false })
        .limit(8);
      if (error) throw error;
      // get project names
      const ids = [...new Set((data || []).map((d) => d.project_id).filter(Boolean))];
      let projectMap = new Map<string, string>();
      if (ids.length > 0) {
        const { data: ps } = await supabase.from("projects").select("id, name").in("id", ids);
        projectMap = new Map((ps || []).map((p) => [p.id, p.name]));
      }
      return (data || []).map((d) => ({ ...d, projectName: projectMap.get(d.project_id!) || "Unknown" }));
    },
  });

  // Auto-refresh every 60s
  useEffect(() => {
    const interval = setInterval(() => refetch(), 60000);
    return () => clearInterval(interval);
  }, [refetch]);

  const severityDot: Record<string, string> = {
    critical: "bg-destructive",
    major: "bg-[hsl(var(--warning))]",
    minor: "bg-[hsl(var(--status-minor))]",
    admin: "bg-[hsl(var(--status-admin))]",
  };

  return (
    <Card className="shadow-subtle">
      <div className="px-5 py-4 border-b flex items-center gap-2">
        <Zap className="h-4 w-4 text-[hsl(var(--fpp-gold))]" />
        <span className="text-[15px] font-semibold text-foreground">AI Activity</span>
      </div>
      <CardContent className="p-5">
        {!aiOutputs || aiOutputs.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">No AI activity yet</p>
        ) : (
          <div className="space-y-3">
            {aiOutputs.map((item) => (
              <div key={item.id} className="flex items-start gap-2">
                <div className={cn("mt-1.5 h-2 w-2 rounded-full shrink-0", severityDot[item.severity || ""] || "bg-muted-foreground")} />
                <div className="flex-1">
                  <p className="text-xs text-foreground/80">
                    {item.prediction || "AI check"} • <span className="text-muted-foreground">{item.projectName}</span>
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {formatDistanceToNow(new Date(item.created_at!), { addSuffix: true })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Revenue KPI Card (currency) ── */
function RevenuKpi({
  icon: Icon, iconColor, label, value, subRow, delay = 0,
}: {
  icon: React.ElementType; iconColor: string; label: string; value: number; subRow?: React.ReactNode; delay?: number;
}) {
  const displayed = useCountUp(value, 800, delay);
  return (
    <Card className="shadow-subtle">
      <CardContent className="p-6 relative">
        <Icon className="absolute top-5 right-5 h-6 w-6" style={{ color: iconColor }} />
        <p className="text-4xl font-bold tracking-tight text-foreground">
          ${displayed.toLocaleString()}
        </p>
        <p className="text-[13px] font-medium text-muted-foreground uppercase tracking-widest mt-1">{label}</p>
        {subRow && <p className="text-xs font-mono text-muted-foreground/80 mt-2">{subRow}</p>}
      </CardContent>
    </Card>
  );
}

/* ── Accounts Receivable Widget ── */
function AccountsReceivableWidget({ navigate }: { navigate: (p: string) => void }) {
  const { data: invoices } = useInvoices();
  const unpaid = useMemo(() =>
    (invoices || [])
      .filter((i) => ["sent", "partial", "overdue"].includes(i.status))
      .sort((a, b) => (Number(b.total) - Number(b.amount_paid)) - (Number(a.total) - Number(a.amount_paid)))
      .slice(0, 5),
    [invoices]
  );

  return (
    <Card className="shadow-subtle">
      <div className="px-5 py-4 border-b flex items-center gap-2">
        <DollarSign className="h-4 w-4 text-[hsl(var(--fpp-gold))]" />
        <span className="text-[15px] font-semibold text-foreground">Accounts Receivable</span>
      </div>
      <CardContent className="p-5">
        {unpaid.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">No outstanding invoices</p>
        ) : (
          <div className="space-y-3">
            {unpaid.map((inv) => {
              const balance = Number(inv.total) - Number(inv.amount_paid);
              const isOverdue = inv.due_at && new Date(inv.due_at) < new Date();
              return (
                <div
                  key={inv.id}
                  className="flex items-center justify-between cursor-pointer hover:bg-muted/30 -mx-2 px-2 py-1.5 rounded transition-colors"
                  onClick={() => navigate(`/projects/${inv.project_id}`)}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium truncate">{inv.project?.name || inv.invoice_number}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {inv.invoice_number}
                      {inv.due_at && <> · Due {format(new Date(inv.due_at), "MMM d")}</>}
                    </p>
                  </div>
                  <span className={cn("text-sm font-semibold tabular-nums ml-3", isOverdue ? "text-destructive" : "text-foreground")}>
                    ${balance.toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <Button variant="link" className="text-accent text-[13px] p-0 mt-3 h-auto" onClick={() => navigate("/invoices")}>
          View all invoices →
        </Button>
      </CardContent>
    </Card>
  );
}

/* ── Main Dashboard ── */
export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: projects, isLoading: projectsLoading } = useProjects();
  const { data: flagCounts } = useReviewFlagCounts();
  const { data: inspections } = useInspections();
  const { data: revenueStats } = useRevenueStats();

  // KPI calculations
  const activeStatuses = ["intake", "plan_review", "comments_sent", "resubmitted"];
  const activeReviews = useMemo(() => (projects || []).filter((p) => activeStatuses.includes(p.status)), [projects]);
  const awaitingResub = useMemo(() => (projects || []).filter((p) => p.status === "comments_sent").length, [projects]);
  const overdueCount = useMemo(() => {
    const now = new Date();
    return (projects || []).filter((p) => p.deadline_at && new Date(p.deadline_at) < now && activeStatuses.includes(p.status)).length;
  }, [projects]);

  // Approvals this week
  const { data: approvalsData } = useQuery({
    queryKey: ["approvals-this-week"],
    queryFn: async () => {
      const now = new Date();
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      const lastWeekStart = new Date(startOfWeek);
      lastWeekStart.setDate(lastWeekStart.getDate() - 7);

      const [thisWeek, lastWeek] = await Promise.all([
        supabase.from("projects").select("id").eq("status", "approved").gte("updated_at", startOfWeek.toISOString()),
        supabase.from("projects").select("id").eq("status", "approved").gte("updated_at", lastWeekStart.toISOString()).lt("updated_at", startOfWeek.toISOString()),
      ]);
      return { thisWeek: thisWeek.data?.length || 0, lastWeek: lastWeek.data?.length || 0 };
    },
  });

  // Pending inspections
  const pendingInspections = useMemo(() =>
    (inspections || []).filter((i) => i.result === "pending" && i.scheduled_at),
    [inspections]
  );
  const nextInspection = pendingInspections[0];

  const openFlags = (flagCounts?.total ?? 0) - (flagCounts?.resolved ?? 0);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const displayName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "there";
  const approvalDiff = (approvalsData?.thisWeek ?? 0) - (approvalsData?.lastWeek ?? 0);

  return (
    <div className="p-4 sm:p-8 md:p-10 max-w-7xl">
      {/* Greeting */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {greeting}, {displayName}.
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{format(now, "EEEE, MMMM d, yyyy")}</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        <DashKpi
          icon={FileText}
          iconColor="#0E7C7B"
          label="active reviews"
          value={activeReviews.length}
          delay={0}
          subRow={<>{awaitingResub} awaiting resubmittal • {overdueCount} overdue</>}
        />
        <DashKpi
          icon={CheckCircle}
          iconColor="#2E7D52"
          label="approved this week"
          value={approvalsData?.thisWeek ?? 0}
          delay={100}
          subRow={
            approvalDiff !== 0 ? (
              <span className={approvalDiff > 0 ? "text-success" : "text-destructive"}>
                {approvalDiff > 0 ? "↑" : "↓"} {Math.abs(approvalDiff)} vs last week
              </span>
            ) : <>same as last week</>
          }
        />
        <DashKpi
          icon={ClipboardCheck}
          iconColor="#C8972A"
          label="inspections scheduled"
          value={pendingInspections.length}
          delay={200}
          subRow={
            nextInspection ? (
              <>Next: {format(new Date(nextInspection.scheduled_at!), "MMM d")}</>
            ) : undefined
          }
        />
        <DashKpi
          icon={AlertTriangle}
          iconColor="#D63230"
          label="open flags across reviews"
          value={openFlags}
          delay={300}
          subRow={
            <>{flagCounts?.critical ?? 0} critical • {flagCounts?.major ?? 0} major • {flagCounts?.minor ?? 0} minor</>
          }
        />
      </div>

      {/* Revenue KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-8">
        <RevenuKpi
          icon={TrendingUp}
          iconColor="#2E7D52"
          label="Revenue MTD"
          value={revenueStats?.revenueMTD ?? 0}
          delay={0}
        />
        <RevenuKpi
          icon={DollarSign}
          iconColor="#C8972A"
          label="Outstanding"
          value={revenueStats?.outstanding ?? 0}
          delay={100}
        />
        <RevenuKpi
          icon={Clock}
          iconColor="#D63230"
          label="Overdue"
          value={revenueStats?.overdue ?? 0}
          delay={200}
          subRow={revenueStats?.overdueCount ? <>{revenueStats.overdueCount} invoice{revenueStats.overdueCount !== 1 ? "s" : ""}</> : undefined}
        />
      </div>

      {/* Quick Actions */}
      <div className="mb-8 flex flex-wrap items-center gap-3">
        <Button onClick={() => navigate("/projects?action=new")} className="bg-primary text-primary-foreground hover:bg-primary/90">
          <Plus className="h-4 w-4 mr-2" /> New Intake
        </Button>
      </div>

      {/* Main 2-column layout */}
      <div className="grid gap-6 lg:grid-cols-[65%_1fr]">
        {/* Left: Active Reviews Queue */}
        <div>
          <h2 className="text-xl font-semibold text-foreground mb-4">Active Reviews</h2>
          {projectsLoading ? (
            <Card className="shadow-subtle">
              <div className="p-4 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={6} />)}
              </div>
            </Card>
          ) : (
            <ActiveReviewsQueue projects={projects || []} navigate={navigate} />
          )}
        </div>

        {/* Right: Deadlines + AI Activity */}
        <div className="space-y-6">
          <DeadlinesPanel projects={projects || []} navigate={navigate} />
          <AccountsReceivableWidget navigate={navigate} />
          <AIActivityFeed />
        </div>
      </div>
    </div>
  );
}
