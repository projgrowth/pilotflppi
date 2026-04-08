import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { useProjects, getDaysElapsed, getDaysRemaining } from "@/hooks/useProjects";
import { cn } from "@/lib/utils";

const filters = ["All", "Critical", "This Week", "Upcoming"] as const;

export default function Deadlines() {
  const [filter, setFilter] = useState<typeof filters[number]>("All");
  const { data: projects, isLoading } = useProjects();
  const navigate = useNavigate();

  const deadlineProjects = (projects || [])
    .filter((p) => p.deadline_at && !["certificate_issued", "cancelled"].includes(p.status))
    .map((p) => ({
      ...p,
      daysElapsed: getDaysElapsed(p.notice_filed_at),
      remaining: getDaysRemaining(p.deadline_at),
    }))
    .sort((a, b) => a.remaining - b.remaining);

  const filtered = deadlineProjects.filter((d) => {
    if (filter === "Critical") return d.remaining <= 3;
    if (filter === "This Week") return d.remaining <= 7 && d.remaining > 0;
    if (filter === "Upcoming") return d.remaining > 7;
    return true;
  });

  return (
    <div className="p-6 md:p-8 max-w-7xl">
      <h1 className="text-2xl font-medium mb-6">Deadlines</h1>
      <div className="mb-6 flex gap-1">
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "px-3 py-1.5 text-sm rounded-md transition-colors",
              filter === f ? "bg-accent/10 text-accent font-medium" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {f}
          </button>
        ))}
      </div>

      <Card className="shadow-subtle border">
        <CardContent className="p-0 divide-y">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4">
                <div className="w-40 space-y-1">
                  <div className="h-4 w-32 rounded bg-muted animate-pulse" />
                  <div className="h-3 w-24 rounded bg-muted animate-pulse" />
                </div>
                <div className="flex-1 h-3 rounded-full bg-muted animate-pulse" />
                <div className="h-4 w-16 rounded bg-muted animate-pulse" />
              </div>
            ))
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No deadlines match this filter</div>
          ) : (
            filtered.map((d) => {
              const progress = Math.min(d.daysElapsed / 21, 1);
              const barColor = d.remaining <= 0 ? "bg-destructive" : d.remaining <= 3 ? "bg-destructive" : d.remaining <= 6 ? "bg-warning" : "bg-success";
              const isOverdue = d.remaining <= 0;
              return (
                <div
                  key={d.id}
                  onClick={() => navigate(`/projects/${d.id}`)}
                  className={cn("flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-muted/30 transition-colors", isOverdue && "bg-destructive/5")}
                >
                  <div className="w-40 shrink-0">
                    <p className="text-sm font-medium truncate">{d.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{d.address}</p>
                  </div>
                  <div className="flex-1">
                    <div className="h-3 rounded-full bg-muted overflow-hidden">
                      <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${progress * 100}%` }} />
                    </div>
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
