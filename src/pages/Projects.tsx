import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/StatusChip";
import { DeadlineRing } from "@/components/DeadlineRing";
import { useProjects, getDaysElapsed, getDaysRemaining } from "@/hooks/useProjects";
import { Search, ChevronRight, FolderKanban } from "lucide-react";
import { cn } from "@/lib/utils";

const filters = ["All", "Plan Review", "Inspection", "Pending", "Complete"] as const;

export default function Projects() {
  const [activeFilter, setActiveFilter] = useState<typeof filters[number]>("All");
  const [search, setSearch] = useState("");
  const { data: projects, isLoading } = useProjects();
  const navigate = useNavigate();

  const filtered = (projects || []).filter((p) => {
    if (search) {
      const q = search.toLowerCase();
      if (!p.name.toLowerCase().includes(q) && !p.address.toLowerCase().includes(q)) return false;
    }
    if (activeFilter === "All") return true;
    if (activeFilter === "Plan Review") return p.status === "plan_review" || p.status === "comments_sent" || p.status === "resubmitted";
    if (activeFilter === "Inspection") return p.status === "inspection_scheduled" || p.status === "inspection_complete";
    if (activeFilter === "Pending") return p.status === "intake" || p.status === "on_hold";
    if (activeFilter === "Complete") return p.status === "approved" || p.status === "certificate_issued" || p.status === "permit_issued";
    return true;
  });

  return (
    <div className="p-6 md:p-8 max-w-7xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-medium">Projects</h1>
        <Button className="bg-accent text-accent-foreground hover:bg-accent/90">+ New Project</Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className="flex gap-1">
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={cn(
                "px-3 py-1.5 text-sm rounded-md transition-colors",
                activeFilter === f
                  ? "bg-accent/10 text-accent font-medium border-b-2 border-accent"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search projects..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 w-64" />
        </div>
      </div>

      <Card className="shadow-subtle border">
        {isLoading ? (
          <div className="divide-y">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-3">
                <div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-48 rounded bg-muted animate-pulse" />
                  <div className="h-3 w-64 rounded bg-muted animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FolderKanban className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <h3 className="text-sm font-medium">No projects found</h3>
            <p className="text-xs text-muted-foreground mt-1">Try adjusting your filters or search</p>
          </div>
        ) : (
          <div className="divide-y">
            {filtered.map((project) => {
              const daysElapsed = getDaysElapsed(project.notice_filed_at);
              const remaining = getDaysRemaining(project.deadline_at);
              return (
                <div
                  key={project.id}
                  onClick={() => navigate(`/projects/${project.id}`)}
                  className="flex items-center gap-4 px-5 py-3 hover:bg-muted/30 transition-colors cursor-pointer"
                >
                  <DeadlineRing daysElapsed={daysElapsed} size={40} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{project.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{project.address}</p>
                  </div>
                  <span className="hidden sm:inline text-xs text-muted-foreground">
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
    </div>
  );
}
