import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const filters = ["All", "Critical", "This Week", "Upcoming"] as const;

const mockDeadlines = [
  { id: "1", name: "Oceanview Tower", address: "1200 Ocean Dr", daysElapsed: 6, total: 21 },
  { id: "2", name: "Palm Gardens Condo", address: "450 Palm Ave", daysElapsed: 16, total: 21 },
  { id: "3", name: "Sunrise Medical Center", address: "800 Sunrise Blvd", daysElapsed: 19, total: 21 },
  { id: "4", name: "Harbor Point Retail", address: "325 Harbor Rd", daysElapsed: 2, total: 21 },
  { id: "5", name: "Cypress Bay Office", address: "1100 Cypress Dr", daysElapsed: 22, total: 21 },
];

export default function Deadlines() {
  const [filter, setFilter] = useState<typeof filters[number]>("All");

  const filtered = mockDeadlines.filter((d) => {
    const remaining = d.total - d.daysElapsed;
    if (filter === "Critical") return remaining <= 3;
    if (filter === "This Week") return remaining <= 7 && remaining > 0;
    if (filter === "Upcoming") return remaining > 7;
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
          {filtered.map((d) => {
            const remaining = d.total - d.daysElapsed;
            const progress = Math.min(d.daysElapsed / d.total, 1);
            const barColor = remaining <= 0 ? "bg-destructive" : remaining <= 3 ? "bg-destructive" : remaining <= 6 ? "bg-warning" : "bg-success";
            const isOverdue = remaining <= 0;
            return (
              <div key={d.id} className={cn("flex items-center gap-4 px-5 py-4", isOverdue && "bg-destructive/5")}>
                <div className="w-40 shrink-0">
                  <p className="text-sm font-medium truncate">{d.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{d.address}</p>
                </div>
                <div className="flex-1">
                  <div className="h-3 rounded-full bg-muted overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${progress * 100}%` }} />
                  </div>
                </div>
                <span className={cn("font-mono text-sm font-medium w-20 text-right", isOverdue ? "text-destructive" : remaining <= 3 ? "text-destructive" : remaining <= 6 ? "text-warning" : "text-success")}>
                  {isOverdue ? "OVERDUE" : `${remaining}d left`}
                </span>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
