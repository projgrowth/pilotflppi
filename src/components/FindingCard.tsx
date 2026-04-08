import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getDisciplineIcon, getDisciplineColor, getDisciplineLabel } from "@/lib/county-utils";
import { AlertTriangle, AlertCircle, Info, CheckCircle2, HelpCircle, CheckCheck, MapPin, Clock, ArrowRightLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, forwardRef } from "react";
import type { FindingStatus } from "@/components/FindingStatusFilter";

interface MarkupData {
  page_index: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  annotations?: { x: number; y: number; width: number; height: number; label?: string }[];
}

export interface Finding {
  severity: string;
  discipline?: string;
  code_ref: string;
  county_specific?: boolean;
  page: string;
  description: string;
  recommendation: string;
  confidence?: string;
  markup?: MarkupData;
  resolved?: boolean;
}

const severityConfig: Record<string, { icon: typeof AlertTriangle; bar: string; badge: string }> = {
  critical: {
    icon: AlertTriangle,
    bar: "bg-destructive",
    badge: "bg-destructive/10 text-destructive border-destructive/20",
  },
  major: {
    icon: AlertCircle,
    bar: "bg-[hsl(var(--warning))]",
    badge: "bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/20",
  },
  minor: {
    icon: Info,
    bar: "bg-muted-foreground/40",
    badge: "bg-muted text-muted-foreground border-border",
  },
};

const statusOptions: { value: FindingStatus; icon: typeof Clock; label: string; className: string }[] = [
  { value: "open", icon: Clock, label: "Open", className: "text-destructive" },
  { value: "resolved", icon: CheckCheck, label: "Resolved", className: "text-[hsl(var(--success))]" },
  { value: "deferred", icon: ArrowRightLeft, label: "Deferred", className: "text-[hsl(var(--warning))]" },
];

interface FindingCardProps {
  finding: Finding;
  index: number;
  globalIndex?: number;
  isActive?: boolean;
  onLocateClick?: () => void;
  animationDelay?: number;
  status?: FindingStatus;
  onStatusChange?: (status: FindingStatus) => void;
}

export const FindingCard = forwardRef<HTMLDivElement, FindingCardProps>(
  ({ finding, index, globalIndex, isActive, onLocateClick, animationDelay = 0, status = "open", onStatusChange }, ref) => {
    const [expanded, setExpanded] = useState(false);
    const sev = severityConfig[finding.severity] || severityConfig.minor;
    const SevIcon = sev.icon;
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

    return (
      <div
        ref={ref}
        className={cn(
          "relative rounded-lg border overflow-hidden cursor-pointer transition-all duration-200 hover:bg-muted/20",
          "animate-in fade-in slide-in-from-bottom-1",
          isActive && "ring-2 ring-accent bg-accent/5",
          isResolved && "opacity-50",
          isDeferred && "opacity-65"
        )}
        style={{ animationDelay: `${animationDelay}ms`, animationFillMode: "backwards" }}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Severity bar */}
        <div className={cn("absolute left-0 top-0 bottom-0 w-0.5", sev.bar, isResolved && "opacity-30")} />

        <div className="px-3 py-2 pl-3.5">
          <div className="flex items-start gap-2">
            {/* Number */}
            <span className={cn(
              "text-[10px] font-mono font-bold mt-0.5 shrink-0 w-4 text-right",
              isActive ? "text-accent" : "text-muted-foreground/50"
            )}>
              {displayIndex + 1}
            </span>

            {/* Content */}
            <div className={cn("flex-1 min-w-0 space-y-1", isResolved && "line-through decoration-muted-foreground/30")}>
              {/* Meta row */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <Badge className={cn("text-[9px] uppercase font-semibold border h-4 px-1", sev.badge)}>
                  {finding.severity}
                </Badge>
                <code className="text-[10px] font-mono text-foreground/70 bg-muted/50 px-1 rounded">
                  {finding.code_ref}
                </code>
                {finding.page && (
                  <span className="text-[9px] text-muted-foreground">
                    pg {finding.page}
                  </span>
                )}
                {finding.county_specific && (
                  <Badge variant="outline" className="text-[8px] font-medium border-accent text-accent bg-accent/5 h-3.5 px-1">
                    County
                  </Badge>
                )}
                {status !== "open" && (
                  <span className={cn("text-[9px] font-medium", currentStatusOption.className)}>
                    {currentStatusOption.label}
                  </span>
                )}
              </div>

              {/* Description */}
              <p className="text-[12px] leading-relaxed text-foreground/85">{finding.description}</p>

              {/* Recommendation (expanded) */}
              {expanded && finding.recommendation && (
                <div className="mt-1.5 rounded bg-muted/40 border border-border/40 px-2.5 py-2">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Recommendation</p>
                  <p className="text-[11px] text-foreground/75 leading-relaxed">{finding.recommendation}</p>
                </div>
              )}
            </div>

            {/* Actions column */}
            <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
              {finding.markup && onLocateClick && (
                <button
                  className="p-1 rounded text-muted-foreground/40 hover:text-accent hover:bg-accent/10 transition-colors"
                  onClick={(e) => { e.stopPropagation(); onLocateClick(); }}
                  title="Locate on plan"
                >
                  <MapPin className="h-3 w-3" />
                </button>
              )}
              <button
                className={cn("p-1 rounded transition-colors", currentStatusOption.className, "opacity-50 hover:opacity-100 hover:bg-muted/50")}
                onClick={(e) => { e.stopPropagation(); cycleStatus(); }}
                title={`${currentStatusOption.label} — Click to change`}
              >
                <StatusIcon className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
);

FindingCard.displayName = "FindingCard";