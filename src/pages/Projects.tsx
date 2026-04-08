import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusChip, type StatusType } from "@/components/StatusChip";
import { DeadlineRing } from "@/components/DeadlineRing";
import { Search, ChevronRight, FolderKanban } from "lucide-react";
import { cn } from "@/lib/utils";

const filters = ["All", "Plan Review", "Inspection", "Pending", "Complete"] as const;

const mockProjects = [
  { id: "1", name: "Oceanview Tower", address: "1200 Ocean Dr, Miami Beach", contractor: "Coastal Builders", trade: "Structural", county: "Miami-Dade", status: "plan_review" as StatusType, daysElapsed: 6 },
  { id: "2", name: "Palm Gardens Condo", address: "450 Palm Ave, Fort Lauderdale", contractor: "Sunshine Dev", trade: "Electrical", county: "Broward", status: "inspection" as StatusType, daysElapsed: 16 },
  { id: "3", name: "Sunrise Medical Center", address: "800 Sunrise Blvd, Tampa", contractor: "Gulf Coast Const.", trade: "Mechanical", county: "Hillsborough", status: "comments_sent" as StatusType, daysElapsed: 19 },
  { id: "4", name: "Harbor Point Retail", address: "325 Harbor Rd, Jacksonville", contractor: "Atlantic Corp", trade: "Plumbing", county: "Duval", status: "intake" as StatusType, daysElapsed: 2 },
  { id: "5", name: "Bay Tower Residences", address: "900 Bay St, Naples", contractor: "Coastal Builders", trade: "Structural", county: "Collier", status: "complete" as StatusType, daysElapsed: 21 },
];

export default function Projects() {
  const [activeFilter, setActiveFilter] = useState<typeof filters[number]>("All");
  const [search, setSearch] = useState("");

  const filtered = mockProjects.filter((p) => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.address.toLowerCase().includes(search.toLowerCase())) return false;
    if (activeFilter === "All") return true;
    if (activeFilter === "Plan Review") return p.status === "plan_review" || p.status === "in_review";
    if (activeFilter === "Inspection") return p.status === "inspection";
    if (activeFilter === "Pending") return p.status === "intake" || p.status === "comments_sent" || p.status === "pending";
    if (activeFilter === "Complete") return p.status === "complete" || p.status === "approved";
    return true;
  });

  return (
    <div className="p-6 md:p-8 max-w-7xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-medium">Projects</h1>
        <Button className="bg-accent text-accent-foreground hover:bg-accent/90">
          + New Project
        </Button>
      </div>

      {/* Filters */}
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
          <Input
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 w-64"
          />
        </div>
      </div>

      {/* Table */}
      <Card className="shadow-subtle border">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FolderKanban className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <h3 className="text-sm font-medium">No projects found</h3>
            <p className="text-xs text-muted-foreground mt-1">Try adjusting your filters or search</p>
          </div>
        ) : (
          <div className="divide-y">
            {filtered.map((project) => (
              <div key={project.id} className="flex items-center gap-4 px-5 py-3 hover:bg-muted/30 transition-colors cursor-pointer">
                <DeadlineRing daysElapsed={project.daysElapsed} size={40} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{project.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{project.address}</p>
                </div>
                <span className="hidden sm:inline text-xs text-muted-foreground">{project.contractor}</span>
                <span className="hidden md:inline-flex rounded bg-muted px-2 py-0.5 text-[10px] font-medium">{project.trade}</span>
                <span className="hidden lg:inline text-xs text-muted-foreground">{project.county}</span>
                <StatusChip status={project.status} />
                <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                  {21 - project.daysElapsed > 0 ? `${21 - project.daysElapsed}d left` : "Overdue"}
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
