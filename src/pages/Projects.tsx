import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/StatusChip";
import { DeadlineRing } from "@/components/DeadlineRing";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { NewPlanReviewWizard } from "@/components/NewPlanReviewWizard";
import { useProjects, getDaysElapsed, getDaysRemaining } from "@/hooks/useProjects";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Search, ChevronRight, FolderKanban, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

const filters = ["All", "Plan Review", "Inspection", "Pending", "Complete"] as const;

const FLORIDA_COUNTIES = [
  "miami-dade", "broward", "palm-beach", "hillsborough", "orange", "duval",
  "pinellas", "lee", "brevard", "volusia", "sarasota", "manatee", "collier",
  "polk", "seminole", "pasco", "osceola", "st-lucie", "escambia", "marion",
];


export default function Projects() {
  const [activeFilter, setActiveFilter] = useState<typeof filters[number]>("All");
  const [search, setSearch] = useState("");
  const [countyFilter, setCountyFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"newest" | "deadline">("newest");
  const { data: projects, isLoading } = useProjects();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => {
    if (searchParams.get("action") === "new") {
      setWizardOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const filtered = (projects || []).filter((p) => {
    if (search) {
      const q = search.toLowerCase();
      if (!p.name.toLowerCase().includes(q) && !p.address.toLowerCase().includes(q)) return false;
    }
    if (countyFilter !== "all" && p.county !== countyFilter) return false;
    if (activeFilter === "All") return true;
    if (activeFilter === "Plan Review") return p.status === "plan_review" || p.status === "comments_sent" || p.status === "resubmitted";
    if (activeFilter === "Inspection") return p.status === "inspection_scheduled" || p.status === "inspection_complete";
    if (activeFilter === "Pending") return p.status === "intake" || p.status === "on_hold";
    if (activeFilter === "Complete") return p.status === "approved" || p.status === "certificate_issued" || p.status === "permit_issued";
    return true;
  }).sort((a, b) => {
    if (sortBy === "deadline") {
      const da = a.deadline_at ? new Date(a.deadline_at).getTime() : Infinity;
      const db = b.deadline_at ? new Date(b.deadline_at).getTime() : Infinity;
      return da - db;
    }
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return (
    <div className="p-8 md:p-10 max-w-7xl">
      <PageHeader
        title="Projects"
        actions={
          <Button className="bg-accent text-accent-foreground hover:bg-accent/90" onClick={() => setWizardOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> New Project
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-4">
        <div className="filter-pills">
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={cn("filter-pill", activeFilter === f && "filter-pill-active")}
            >
              {f}
            </button>
          ))}
        </div>
        <Select value={countyFilter} onValueChange={setCountyFilter}>
          <SelectTrigger className="w-40 h-9 text-xs"><SelectValue placeholder="All Counties" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Counties</SelectItem>
            {FLORIDA_COUNTIES.map((c) => (
              <SelectItem key={c} value={c}>{c.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as "newest" | "deadline")}>
          <SelectTrigger className="w-36 h-9 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest First</SelectItem>
            <SelectItem value="deadline">Deadline Soonest</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative ml-auto">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search projects..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 w-64" />
        </div>
      </div>

      <Card className="shadow-subtle">
        {isLoading ? (
          <div className="divide-y">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4">
                <div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-48 rounded bg-muted animate-pulse" />
                  <div className="h-3 w-64 rounded bg-muted animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title="No projects found"
            description="Try adjusting your filters or search"
          />
        ) : (
          <div className="divide-y">
            {/* Column headers */}
            <div className="hidden md:grid grid-cols-[40px_1fr_100px_80px_80px_120px_80px_20px] gap-4 px-5 py-3 text-[11px] uppercase tracking-widest text-muted-foreground font-semibold border-b bg-muted/20">
              <span />
              <span>Project</span>
              <span>Contractor</span>
              <span>Trade</span>
              <span>County</span>
              <span>Status</span>
              <span>Deadline</span>
              <span />
            </div>
            {filtered.map((project) => {
              const daysElapsed = getDaysElapsed(project.notice_filed_at);
              const remaining = getDaysRemaining(project.deadline_at);
              return (
                <div
                  key={project.id}
                  onClick={() => navigate(`/projects/${project.id}`)}
                  className="list-row"
                >
                  <DeadlineRing daysElapsed={daysElapsed} size={40} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{project.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{project.address}</p>
                  </div>
                  <span className="hidden sm:inline text-xs text-muted-foreground truncate">
                    {project.contractor?.name || "—"}
                  </span>
                  <span className="hidden md:inline-flex rounded bg-muted px-2 py-0.5 text-[10px] font-medium capitalize">
                    {project.trade_type}
                  </span>
                  <span className="hidden lg:inline text-xs text-muted-foreground">{project.county}</span>
                  <StatusChip status={project.status} />
                  <span className={cn(
                    "font-mono text-xs whitespace-nowrap",
                    remaining <= 0 ? "text-destructive" : remaining <= 3 ? "text-destructive" : remaining <= 6 ? "text-warning" : "text-muted-foreground"
                  )}>
                    {remaining <= 0 ? "Overdue" : `${remaining}d left`}
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Upload-first wizard: AI extracts project info from the title block */}
      <NewPlanReviewWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onComplete={(_reviewId, projectId) => navigate(`/projects/${projectId}`)}
      />
    </div>
  );
}
