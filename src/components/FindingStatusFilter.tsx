import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CheckCheck, Clock, ArrowRightLeft } from "lucide-react";
import type { FindingStatus } from "@/types";

export type { FindingStatus } from "@/types";

interface FindingStatusFilterProps {
  activeFilter: FindingStatus | "all";
  counts: Record<FindingStatus | "all", number>;
  onFilterChange: (filter: FindingStatus | "all") => void;
}

const statusConfig: Record<FindingStatus | "all", { label: string; icon?: typeof CheckCheck; className: string }> = {
  all: { label: "All", className: "bg-muted text-muted-foreground" },
  open: { label: "Open", icon: Clock, className: "bg-destructive/10 text-destructive border-destructive/20" },
  resolved: { label: "Resolved", icon: CheckCheck, className: "bg-success/10 text-success border-success/20" },
  deferred: { label: "Deferred", icon: ArrowRightLeft, className: "bg-warning/10 text-warning border-warning/20" },
};

export function FindingStatusFilter({ activeFilter, counts, onFilterChange }: FindingStatusFilterProps) {
  return (
    <div className="flex items-center gap-1.5">
      {(Object.keys(statusConfig) as (FindingStatus | "all")[]).map((key) => {
        const config = statusConfig[key];
        const Icon = config.icon;
        const isActive = activeFilter === key;
        return (
          <button
            key={key}
            onClick={() => onFilterChange(key)}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded-md text-2xs font-medium transition-all border",
              isActive ? config.className : "bg-transparent text-muted-foreground/60 border-transparent hover:bg-muted/50"
            )}
          >
            {Icon && <Icon className="h-3 w-3" />}
            {config.label}
            <span className="ml-0.5 opacity-70">{counts[key]}</span>
          </button>
        );
      })}
    </div>
  );
}
