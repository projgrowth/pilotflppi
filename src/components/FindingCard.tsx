import { Badge } from "@/components/ui/badge";
import { getDisciplineIcon, getDisciplineColor, getDisciplineLabel } from "@/lib/county-utils";
import { AlertTriangle, AlertCircle, Info, CheckCheck, MapPin, Clock, ArrowRightLeft, ChevronRight, History, Move } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, forwardRef } from "react";
import type { FindingStatus } from "@/components/FindingStatusFilter";
import type { FindingHistoryEntry } from "@/hooks/useFindingHistory";
import type { Finding } from "@/types";

export type { Finding } from "@/types";

const severityConfig: Record<string, { icon: typeof AlertTriangle; dot: string; badge: string }> = {
  critical: {
    icon: AlertTriangle,
    dot: "bg-destructive",
    badge: "bg-destructive/10 text-destructive border-destructive/20",
  },
  major: {
    icon: AlertCircle,
    dot: "bg-warning",
    badge: "bg-warning/10 text-warning border-warning/20",
  },
  minor: {
    icon: Info,
    dot: "bg-muted-foreground/40",
    badge: "bg-muted text-muted-foreground border-border",
  },
};

const statusOptions: { value: FindingStatus; icon: typeof Clock; label: string; className: string }[] = [
  { value: "open", icon: Clock, label: "Open", className: "text-destructive" },
  { value: "resolved", icon: CheckCheck, label: "Resolved", className: "text-success" },
  { value: "deferred", icon: ArrowRightLeft, label: "Deferred", className: "text-warning" },
];

interface FindingCardProps {
  finding: Finding;
  index: number;
  globalIndex?: number;
  isActive?: boolean;
  onLocateClick?: () => void;
  onRepositionClick?: () => void;
  animationDelay?: number;
  status?: FindingStatus;
  onStatusChange?: (status: FindingStatus) => void;
  defaultExpanded?: boolean;
  history?: FindingHistoryEntry[];
}

export const FindingCard = forwardRef<HTMLDivElement, FindingCardProps>(
  ({ finding, index, globalIndex, isActive, onLocateClick, onRepositionClick, animationDelay = 0, status = "open", onStatusChange, defaultExpanded = false, history = [] }, ref) => {
    const [expanded, setExpanded] = useState(defaultExpanded);
    const [showHistory, setShowHistory] = useState(false);
    const sev = severityConfig[finding.severity] || severityConfig.minor;
    const isResolved = status === "resolved";
    const isDeferred = status === "deferred";
    const displayIndex = globalIndex !== undefined ? globalIndex : index;

    const cycleStatus = () => {
      if (!onStatusChange) return;
      const order: FindingStatus[] = ["open", "resolved", "deferred"];
      const nextIdx = (order.indexOf(status) + 1) % order.length;
      onStatusChange(order[nextIdx]);
    };

    const currentStatusOption = statusOptions.find((s) => s.value === status)!;
    const StatusIcon = currentStatusOption.icon;

    // Auto-expand when active
    const isExpanded = expanded || isActive;

    return (
      <div
        ref={ref}
        className={cn(
          "relative rounded-md border overflow-hidden cursor-pointer transition-all duration-150",
          "animate-in fade-in slide-in-from-bottom-1",
          isActive && "ring-2 ring-accent bg-accent/5",
          isResolved && "opacity-50",
          isDeferred && "opacity-65"
        )}
        style={{ animationDelay: `${animationDelay}ms`, animationFillMode: "backwards" }}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Collapsed: single-line summary */}
        <div className={cn("px-2.5 py-1.5", isExpanded && "border-b border-border/30")}>
          <div className="flex items-center gap-1.5">
            {/* Severity dot */}
            <div className={cn("h-1.5 w-1.5 rounded-full shrink-0", sev.dot, isResolved && "opacity-30")} />

            {/* Number */}
            <span className="text-caption font-mono text-muted-foreground/50 w-3 text-right shrink-0">
              {displayIndex + 1}
            </span>

            {/* Code ref */}
            <code className="text-2xs font-mono text-foreground/70 shrink-0">
              {finding.code_ref}
            </code>

            {/* Description truncated */}
            <span className={cn(
              "text-xs text-foreground/75 truncate flex-1 min-w-0",
              isResolved && "line-through decoration-muted-foreground/30"
            )}>
              {finding.description}
            </span>

            {/* Status badge (non-open only) */}
            {status !== "open" && (
              <span className={cn("text-caption font-semibold shrink-0", currentStatusOption.className)}>
                {currentStatusOption.label}
              </span>
            )}

            {/* Expand chevron */}
            <ChevronRight className={cn(
              "h-3 w-3 text-muted-foreground/30 shrink-0 transition-transform duration-150",
              isExpanded && "rotate-90"
            )} />
          </div>
        </div>

        {/* Expanded details */}
        {isExpanded && (
          <div className="px-3 py-2 space-y-1.5">
            {/* Meta chips */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge className={cn("text-caption uppercase font-semibold border h-4 px-1", sev.badge)}>
                {finding.severity}
              </Badge>
              {finding.confidence && (
                <Badge variant="outline" className={cn("text-caption font-medium h-3.5 px-1",
                  finding.confidence === "verified" ? "border-success/40 text-success" :
                  finding.confidence === "likely" ? "border-accent/40 text-accent" :
                  "border-muted-foreground/30 text-muted-foreground"
                )}>
                  {finding.confidence}
                </Badge>
              )}
              {finding.page && (
                <span className="text-caption text-muted-foreground">pg {finding.page}</span>
              )}
              {finding.county_specific && (
                <Badge variant="outline" className="text-caption font-medium border-accent text-accent bg-accent/5 h-3.5 px-1">
                  County
                </Badge>
              )}
            </div>

            {/* Full description */}
            <p className={cn(
              "text-[12px] leading-relaxed text-foreground/85",
              isResolved && "line-through decoration-muted-foreground/30"
            )}>
              {finding.description}
            </p>

            {/* Recommendation */}
            {finding.recommendation && (
              <div className="rounded bg-muted/40 border border-border/40 px-2.5 py-2">
                <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Recommendation</p>
                <p className="text-xs text-foreground/75 leading-relaxed">{finding.recommendation}</p>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-1 pt-0.5">
              {finding.markup && onLocateClick && (
                <button
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs text-muted-foreground hover:text-accent hover:bg-accent/10 transition-colors"
                  onClick={(e) => { e.stopPropagation(); onLocateClick(); }}
                >
                  <MapPin className="h-3 w-3" /> Locate
                </button>
              )}
              {finding.markup && onRepositionClick && (
                <button
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs text-muted-foreground hover:text-warning hover:bg-warning/10 transition-colors"
                  onClick={(e) => { e.stopPropagation(); onRepositionClick(); }}
                  title="Pin in the wrong place? Click to reposition."
                >
                  <Move className="h-3 w-3" /> Wrong location?
                </button>
              )}
              <button
                className={cn(
                  "flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs transition-colors",
                  currentStatusOption.className, "opacity-60 hover:opacity-100 hover:bg-muted/50"
                )}
                onClick={(e) => { e.stopPropagation(); cycleStatus(); }}
                title={`${currentStatusOption.label} — Click to change`}
              >
                <StatusIcon className="h-3 w-3" /> {currentStatusOption.label}
              </button>
              {history.length > 0 && (
                <button
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors ml-auto"
                  onClick={(e) => { e.stopPropagation(); setShowHistory(!showHistory); }}
                >
                  <History className="h-3 w-3" /> {history.length}
                </button>
              )}
            </div>

            {/* History log */}
            {showHistory && history.length > 0 && (
              <div className="border-t border-border/30 pt-1.5 mt-1 space-y-1">
                <p className="text-caption font-semibold text-muted-foreground uppercase tracking-wide">Audit Trail</p>
                {history.slice(0, 10).map((h) => (
                  <div key={h.id} className="flex items-center gap-1.5 text-caption text-muted-foreground">
                    <span className="font-mono">{new Date(h.changed_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                    <span className="text-muted-foreground/50">•</span>
                    <span className="capitalize">{h.old_status}</span>
                    <span className="text-muted-foreground/50">→</span>
                    <span className="capitalize font-medium text-foreground/70">{h.new_status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }
);

FindingCard.displayName = "FindingCard";
