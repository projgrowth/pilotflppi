/**
 * Compact triage toolbar for the findings panel.
 *
 * Keeps Status chips always visible (the most-used dimension) and tucks
 * Pin / Discipline / Sheet behind a single "Filters" popover. The popover
 * trigger shows a numeric badge with how many secondary filters are active,
 * so users can see "I have 2 filters on" at a glance without staring at four
 * stacked rows.
 *
 * Bulk "Mark all resolved" stays inline as a quiet ghost button on the right.
 */
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { CheckCheck, Clock, ArrowRightLeft, SlidersHorizontal, X } from "lucide-react";
import type { FindingStatus } from "@/types";

export type ConfidenceFilter = "high" | "medium" | "low" | "all";

interface Props {
  statusCounts: Record<FindingStatus | "all", number>;
  statusFilter: FindingStatus | "all";
  onStatusFilterChange: (s: FindingStatus | "all") => void;

  confidenceCounts: Record<ConfidenceFilter, number>;
  confidenceFilter: ConfidenceFilter;
  onConfidenceFilterChange: (c: ConfidenceFilter) => void;

  disciplines: string[];
  disciplineFilter: string | "all";
  onDisciplineFilterChange: (d: string | "all") => void;

  sheets: string[];
  sheetFilter: string | "all";
  onSheetFilterChange: (s: string | "all") => void;

  visibleCount: number;
  allVisibleResolved: boolean;
  onMarkVisibleResolved: () => void;
}

const statusMeta: Record<FindingStatus | "all", { label: string; icon?: typeof CheckCheck; cls: string }> = {
  all: { label: "All", cls: "bg-muted text-muted-foreground" },
  open: { label: "Open", icon: Clock, cls: "bg-destructive/10 text-destructive border-destructive/20" },
  resolved: { label: "Done", icon: CheckCheck, cls: "bg-success/10 text-success border-success/20" },
  deferred: { label: "Later", icon: ArrowRightLeft, cls: "bg-warning/10 text-warning border-warning/20" },
};

const confidenceMeta: Record<ConfidenceFilter, { label: string; dot: string }> = {
  all: { label: "All", dot: "bg-muted-foreground/40" },
  high: { label: "High confidence", dot: "bg-success" },
  medium: { label: "Medium confidence", dot: "bg-warning" },
  low: { label: "Low confidence", dot: "bg-destructive" },
};

function disciplineLabel(d: string): string {
  if (d === "life_safety") return "Life Safety";
  if (d === "ada") return "ADA";
  if (d === "mep") return "MEP";
  return d.charAt(0).toUpperCase() + d.slice(1);
}

export function BulkTriageFilters({
  statusCounts, statusFilter, onStatusFilterChange,
  confidenceCounts, confidenceFilter, onConfidenceFilterChange,
  disciplines, disciplineFilter, onDisciplineFilterChange,
  sheets, sheetFilter, onSheetFilterChange,
  visibleCount, allVisibleResolved, onMarkVisibleResolved,
}: Props) {
  const secondaryActiveCount =
    (confidenceFilter !== "all" ? 1 : 0) +
    (disciplineFilter !== "all" ? 1 : 0) +
    (sheetFilter !== "all" ? 1 : 0);

  const hasSecondary = disciplines.length > 1 || sheets.length > 1 || true; // pin always shown in popover

  function clearSecondary() {
    onConfidenceFilterChange("all");
    onDisciplineFilterChange("all");
    onSheetFilterChange("all");
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {/* Status chips — always visible */}
      {(Object.keys(statusMeta) as (FindingStatus | "all")[]).map((key) => {
        const m = statusMeta[key];
        const Icon = m.icon;
        const active = statusFilter === key;
        return (
          <button
            key={key}
            onClick={() => onStatusFilterChange(key)}
            className={cn(
              "flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition-all border",
              active ? m.cls : "bg-transparent text-muted-foreground/60 border-transparent hover:bg-muted/50"
            )}
          >
            {Icon && <Icon className="h-3 w-3" />}
            {m.label}
            <span className="opacity-70">{statusCounts[key]}</span>
          </button>
        );
      })}

      {/* Secondary filters tucked into popover */}
      {hasSecondary && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              className={cn(
                "flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition-all border ml-auto",
                secondaryActiveCount > 0
                  ? "bg-accent/15 text-accent border-accent/25"
                  : "bg-transparent text-muted-foreground/60 border-transparent hover:bg-muted/50"
              )}
              title="More filters"
            >
              <SlidersHorizontal className="h-3 w-3" />
              Filter
              {secondaryActiveCount > 0 && (
                <span className="ml-0.5 rounded-full bg-accent text-accent-foreground px-1 text-[9px] font-semibold leading-tight">
                  {secondaryActiveCount}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Filters</span>
              {secondaryActiveCount > 0 && (
                <button
                  onClick={clearSecondary}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                >
                  <X className="h-2.5 w-2.5" /> Clear
                </button>
              )}
            </div>

            {/* Pin confidence */}
            <div className="space-y-1">
              <span className="text-[10px] font-medium text-muted-foreground/80">Pin precision</span>
              <div className="flex items-center gap-1 flex-wrap">
                {(["all", "high", "medium", "low"] as ConfidenceFilter[]).map((key) => {
                  const m = confidenceMeta[key];
                  const active = confidenceFilter === key;
                  return (
                    <button
                      key={key}
                      onClick={() => onConfidenceFilterChange(key)}
                      className={cn(
                        "flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-medium transition-all border",
                        active
                          ? "bg-accent/15 text-accent border-accent/25"
                          : "bg-transparent text-muted-foreground/70 border-border/40 hover:bg-muted/50"
                      )}
                      title={m.label}
                    >
                      {key !== "all" && <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />}
                      {key === "all" ? "All" : m.label.split(" ")[0]}
                      <span className="opacity-70">{confidenceCounts[key]}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Discipline (only when 2+) */}
            {disciplines.length > 1 && (
              <div className="space-y-1">
                <span className="text-[10px] font-medium text-muted-foreground/80">Discipline</span>
                <div className="flex items-center gap-1 flex-wrap">
                  <button
                    onClick={() => onDisciplineFilterChange("all")}
                    className={cn(
                      "px-1.5 py-0.5 rounded-md text-[11px] font-medium transition-all border",
                      disciplineFilter === "all"
                        ? "bg-accent/15 text-accent border-accent/25"
                        : "bg-transparent text-muted-foreground/70 border-border/40 hover:bg-muted/50"
                    )}
                  >All</button>
                  {disciplines.map((d) => (
                    <button
                      key={d}
                      onClick={() => onDisciplineFilterChange(d)}
                      className={cn(
                        "px-1.5 py-0.5 rounded-md text-[11px] font-medium transition-all border",
                        disciplineFilter === d
                          ? "bg-accent/15 text-accent border-accent/25"
                          : "bg-transparent text-muted-foreground/70 border-border/40 hover:bg-muted/50"
                      )}
                    >{disciplineLabel(d)}</button>
                  ))}
                </div>
              </div>
            )}

            {/* Sheet (only when 2+) */}
            {sheets.length > 1 && (
              <div className="space-y-1">
                <span className="text-[10px] font-medium text-muted-foreground/80">Sheet</span>
                <div className="flex items-center gap-1 flex-wrap">
                  <button
                    onClick={() => onSheetFilterChange("all")}
                    className={cn(
                      "px-1.5 py-0.5 rounded-md text-[11px] font-medium transition-all border",
                      sheetFilter === "all"
                        ? "bg-accent/15 text-accent border-accent/25"
                        : "bg-transparent text-muted-foreground/70 border-border/40 hover:bg-muted/50"
                    )}
                  >All</button>
                  {sheets.map((s) => (
                    <button
                      key={s}
                      onClick={() => onSheetFilterChange(s)}
                      className={cn(
                        "px-1.5 py-0.5 rounded-md text-[11px] font-medium transition-all border",
                        sheetFilter === s
                          ? "bg-accent/15 text-accent border-accent/25"
                          : "bg-transparent text-muted-foreground/70 border-border/40 hover:bg-muted/50"
                      )}
                    >{s}</button>
                  ))}
                </div>
              </div>
            )}

            {/* Bulk action lives inside the popover so it's only one click away when triaging a filtered set */}
            {visibleCount > 0 && !allVisibleResolved && (
              <div className="pt-2 border-t border-border/40">
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full h-7 px-2 text-[11px] gap-1 text-success hover:text-success hover:bg-success/10"
                  onClick={onMarkVisibleResolved}
                >
                  <CheckCheck className="h-3 w-3" />
                  Mark {visibleCount} visible resolved
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
