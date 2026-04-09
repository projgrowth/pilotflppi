import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { useProjects, getDaysElapsed, getDaysRemaining } from "@/hooks/useProjects";
import { getStatutoryStatus } from "@/lib/statutory-deadlines";
import { cn } from "@/lib/utils";
import { Gavel } from "lucide-react";

const filters = ["All", "Critical", "This Week", "Upcoming", "Statutory"] as const;

export default function Deadlines() {
  const [filter, setFilter] = useState<typeof filters[number]>("All");
  const { data: projects, isLoading } = useProjects();
  const navigate = useNavigate();

  const deadlineProjects = (projects || [])
    .filter((p) => p.deadline_at && !["certificate_issued", "cancelled"].includes(p.status))
    .map((p) => {
      const stat = getStatutoryStatus(p);
      return {
        ...p,
        daysElapsed: getDaysElapsed(p.notice_filed_at),
        remaining: getDaysRemaining(p.deadline_at),
        statutory: stat,
      };
    })
    .sort((a, b) => a.remaining - b.remaining);

  const filtered = deadlineProjects.filter((d) => {
    if (filter === "Critical") return d.remaining <= 3;
    if (filter === "This Week") return d.remaining <= 7 && d.remaining > 0;
    if (filter === "Upcoming") return d.remaining > 7;
    if (filter === "Statutory") return d.statutory.phase === "review" || d.statutory.phase === "inspection";
    return true;
  });

  return (
    <div className="p-8 md:p-10 max-w-7xl">
      <PageHeader title="Deadlines" />

      <div className="mb-6 filter-pills w-fit">
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "filter-pill flex items-center gap-1",
              filter === f && "filter-pill-active"
            )}
          >
            {f === "Statutory" && <Gavel className="h-3 w-3" />}
            {f}
          </button>
        ))}
      </div>

      <Card className="shadow-subtle">
        <CardContent className="p-0 divide-y">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-5">
                <div className="w-40 space-y-1">
                  <div className="h-4 w-32 rounded bg-muted animate-pulse" />
                  <div className="h-3 w-24 rounded bg-muted animate-pulse" />
                </div>
                <div className="flex-1 h-3 rounded-full bg-muted animate-pulse" />
                <div className="h-4 w-16 rounded bg-muted animate-pulse" />
              </div>
            ))
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">No deadlines match this filter</div>
          ) : (
            filtered.map((d) => {
              const progress = Math.min(d.daysElapsed / 21, 1);
              const barColor = d.remaining <= 0 ? "bg-destructive" : d.remaining <= 3 ? "bg-destructive" : d.remaining <= 6 ? "bg-warning" : "bg-success";
              const isOverdue = d.remaining <= 0;
              const showStatutory = d.statutory.phase === "review" || d.statutory.phase === "inspection";
              const statRemaining = d.statutory.phase === "review" ? d.statutory.reviewDaysRemaining : d.statutory.inspectionDaysRemaining;
              const statTotal = d.statutory.phase === "review" ? d.statutory.reviewDaysTotal : d.statutory.inspectionDaysTotal;
              const statUsed = d.statutory.phase === "review" ? d.statutory.reviewDaysUsed : d.statutory.inspectionDaysUsed;
              const statProgress = statTotal > 0 ? Math.min(statUsed / statTotal, 1) : 0;
              const statBarColor = statRemaining <= 3 ? "bg-destructive" : statRemaining <= 5 ? "bg-warning" : "bg-accent";

              return (
                <div
                  key={d.id}
                  onClick={() => navigate(`/projects/${d.id}`)}
                  className={cn("flex items-center gap-4 px-5 py-5 cursor-pointer hover:bg-muted/30 transition-colors", isOverdue && "bg-destructive/5")}
                >
                  <div className="w-44 shrink-0">
                    <p className="text-sm font-medium truncate">{d.name}</p>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{d.address}</p>
                  </div>
                  <div className="flex-1 space-y-2">
                    {/* Contractual deadline */}
                    <div className="h-3 rounded-full bg-muted overflow-hidden">
                      <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${progress * 100}%` }} />
                    </div>
                    {/* Statutory deadline */}
                    {showStatutory && (
                      <div className="flex items-center gap-2">
                        <Gavel className="h-3 w-3 text-muted-foreground shrink-0" />
                        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                          <div className={cn("h-full rounded-full transition-all", statBarColor)} style={{ width: `${statProgress * 100}%` }} />
                        </div>
                        <span className="text-[10px] font-mono text-muted-foreground w-12 text-right">{statRemaining}B</span>
                      </div>
                    )}
                  </div>
                  <span className={cn(
                    "font-mono text-sm font-medium w-20 text-right",
                    isOverdue ? "text-destructive" : d.remaining <= 3 ? "text-destructive" : d.remaining <= 6 ? "text-warning" : "text-success"
                  )}>
                    {isOverdue ? "OVERDUE" : `${d.remaining}d left`}
                  </span>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
