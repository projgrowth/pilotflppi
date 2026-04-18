/**
 * Bulk triage chip strip for the findings panel.
 *
 * Three filter dimensions stacked into one compact strip:
 *   1. Status   (open | resolved | deferred | all)
 *   2. Confidence (high | medium | low | all)   — pin precision tiers
 *   3. Discipline (any of the disciplines present)
 *   4. Sheet     (any unique `page` value present)
 *
 * Plus a one-shot "Mark sheet reviewed" bulk action that resolves every
 * currently-visible finding under the active sheet filter.
 *
 * The component is dumb: parents pass counts + active values + setters and
 * receive a callback when the user clicks the bulk action.
 */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CheckCheck, Clock, ArrowRightLeft, CircleDot, Sparkles } from "lucide-react";
import type { FindingStatus } from "@/types";

export type ConfidenceFilter = "high" | "medium" | "low" | "all";

interface Props {
  /** Status counts (always shown). */
  statusCounts: Record<FindingStatus | "all", number>;
  statusFilter: FindingStatus | "all";
  onStatusFilterChange: (s: FindingStatus | "all") => void;

  /** Pin-confidence counts. */
  confidenceCounts: Record<ConfidenceFilter, number>;
  confidenceFilter: ConfidenceFilter;
  onConfidenceFilterChange: (c: ConfidenceFilter) => void;

  /** Disciplines present in the result set, in display order. */
  disciplines: string[];
  disciplineFilter: string | "all";
  onDisciplineFilterChange: (d: string | "all") => void;

  /** Unique sheet labels present in the result set. */
  sheets: string[];
  sheetFilter: string | "all";
  onSheetFilterChange: (s: string | "all") => void;

  /**
   * Number of findings currently visible after all filters. Drives the
   * label on the bulk action and disables it when the visible set is empty
   * or already fully resolved.
   */
  visibleCount: number;
  /** All currently visible findings already resolved? */
  allVisibleResolved: boolean;
  onMarkVisibleResolved: () => void;
}

const statusMeta: Record<FindingStatus | "all", { label: string; icon?: typeof CheckCheck; cls: string }> = {
  all: { label: "All", cls: "bg-muted text-muted-foreground" },
  open: { label: "Open", icon: Clock, cls: "bg-destructive/10 text-destructive border-destructive/20" },
  resolved: { label: "Resolved", icon: CheckCheck, cls: "bg-success/10 text-success border-success/20" },
  deferred: { label: "Deferred", icon: ArrowRightLeft, cls: "bg-warning/10 text-warning border-warning/20" },
};

const confidenceMeta: Record<ConfidenceFilter, { label: string; cls: string; dot: string }> = {
  all: { label: "All", cls: "bg-muted text-muted-foreground", dot: "bg-muted-foreground/40" },
  high: { label: "High", cls: "bg-success/10 text-success border-success/20", dot: "bg-success" },
  medium: { label: "Med", cls: "bg-warning/10 text-warning border-warning/20", dot: "bg-warning" },
  low: { label: "Low", cls: "bg-destructive/10 text-destructive border-destructive/20", dot: "bg-destructive" },
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
  return (
    <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/20 p-1.5">
      {/* Row 1: Status */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wide w-12 shrink-0">Status</span>
        {(Object.keys(statusMeta) as (FindingStatus | "all")[]).map((key) => {
          const m = statusMeta[key];
          const Icon = m.icon;
          const active = statusFilter === key;
          return (
            <button
              key={key}
              onClick={() => onStatusFilterChange(key)}
              className={cn(
                "flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium transition-all border",
                active ? m.cls : "bg-transparent text-muted-foreground/60 border-transparent hover:bg-muted/50"
              )}
            >
              {Icon && <Icon className="h-2.5 w-2.5" />}
              {m.label}
              <span className="opacity-70">{statusCounts[key]}</span>
            </button>
          );
        })}
      </div>

      {/* Row 2: Confidence */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wide w-12 shrink-0">Pin</span>
        {(["all", "high", "medium", "low"] as ConfidenceFilter[]).map((key) => {
          const m = confidenceMeta[key];
          const active = confidenceFilter === key;
          return (
            <button
              key={key}
              onClick={() => onConfidenceFilterChange(key)}
              className={cn(
                "flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium transition-all border",
                active ? m.cls : "bg-transparent text-muted-foreground/60 border-transparent hover:bg-muted/50"
              )}
              title={`${m.label}-confidence pins`}
            >
              {key !== "all" && <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />}
              {m.label}
              <span className="opacity-70">{confidenceCounts[key]}</span>
            </button>
          );
        })}
      </div>

      {/* Row 3: Discipline (only when 2+ present) */}
      {disciplines.length > 1 && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wide w-12 shrink-0">Disc.</span>
          <button
            onClick={() => onDisciplineFilterChange("all")}
            className={cn(
              "flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium transition-all border",
              disciplineFilter === "all" ? "bg-muted text-muted-foreground" : "bg-transparent text-muted-foreground/60 border-transparent hover:bg-muted/50"
            )}
          >All</button>
          {disciplines.map((d) => (
            <button
              key={d}
              onClick={() => onDisciplineFilterChange(d)}
              className={cn(
                "flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium transition-all border",
                disciplineFilter === d ? "bg-accent/15 text-accent border-accent/25" : "bg-transparent text-muted-foreground/60 border-transparent hover:bg-muted/50"
              )}
            >{disciplineLabel(d)}</button>
          ))}
        </div>
      )}

      {/* Row 4: Sheet (only when 2+ present) */}
      {sheets.length > 1 && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wide w-12 shrink-0">Sheet</span>
          <button
            onClick={() => onSheetFilterChange("all")}
            className={cn(
              "flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium transition-all border",
              sheetFilter === "all" ? "bg-muted text-muted-foreground" : "bg-transparent text-muted-foreground/60 border-transparent hover:bg-muted/50"
            )}
          >All</button>
          {sheets.map((s) => (
            <button
              key={s}
              onClick={() => onSheetFilterChange(s)}
              className={cn(
                "flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium transition-all border",
                sheetFilter === s ? "bg-accent/15 text-accent border-accent/25" : "bg-transparent text-muted-foreground/60 border-transparent hover:bg-muted/50"
              )}
              title={`Sheet ${s}`}
            >{s}</button>
          ))}
        </div>
      )}

      {/* Bulk action row */}
      {visibleCount > 0 && !allVisibleResolved && (
        <div className="flex items-center justify-between pt-0.5 border-t border-border/40">
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <CircleDot className="h-2.5 w-2.5" />
            {visibleCount} match{visibleCount === 1 ? "" : "es"}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-5 px-2 text-[10px] gap-1 text-success hover:text-success hover:bg-success/10"
            onClick={onMarkVisibleResolved}
          >
            <CheckCheck className="h-2.5 w-2.5" />
            Mark all resolved
          </Button>
        </div>
      )}
    </div>
  );
}
