import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getDisciplineIcon, getDisciplineColor, getDisciplineLabel } from "@/lib/county-utils";
import { AlertTriangle, AlertCircle, Info, CheckCircle2, HelpCircle, Flag, CheckCheck, MapPin, Clock, ArrowRightLeft } from "lucide-react";
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

const confidenceConfig: Record<string, { icon: typeof CheckCircle2; label: string; className: string }> = {
  verified: { icon: CheckCircle2, label: "Verified", className: "text-[hsl(var(--success))]" },
  likely: { icon: HelpCircle, label: "Likely", className: "text-[hsl(var(--warning))]" },
  advisory: { icon: Info, label: "Advisory", className: "text-muted-foreground" },
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
    const [flagged, setFlagged] = useState(false);
    const sev = severityConfig[finding.severity] || severityConfig.minor;
    const SevIcon = sev.icon;
    const conf = finding.confidence ? confidenceConfig[finding.confidence] : null;
    const ConfIcon = conf?.icon;
    const DisciplineIcon = finding.discipline ? getDisciplineIcon(finding.discipline) : null;
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
      <Card
        ref={ref}
        className={cn(
          "shadow-subtle border overflow-hidden cursor-pointer transition-all duration-300 hover:shadow-md",
          "relative animate-in fade-in slide-in-from-bottom-2",
          isActive && "ring-2 ring-accent shadow-lg",
          flagged && "ring-1 ring-accent/50",
          isResolved && "opacity-60",
          isDeferred && "opacity-75"
        )}
        style={{ animationDelay: `${animationDelay}ms`, animationFillMode: "backwards" }}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Severity left bar */}
        <div className={cn("absolute left-0 top-0 bottom-0 w-1", sev.bar, isResolved && "opacity-30")} />

        <CardContent className="p-4 pl-5">
          <div className="flex items-start gap-3">
            <span className={cn(
              "text-[10px] font-mono font-bold mt-1 shrink-0 w-5 text-right",
              isActive ? "text-accent" : "text-muted-foreground/60"
            )}>
              #{displayIndex + 1}
            </span>

            <div className={cn("rounded-md p-1.5 shrink-0 mt-0.5", sev.badge)}>
              <SevIcon className="h-3.5 w-3.5" />
            </div>

            <div className={cn("flex-1 min-w-0 space-y-1.5", isResolved && "line-through decoration-muted-foreground/40")}>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={cn("text-[10px] uppercase font-semibold border", sev.badge)}>
                  {finding.severity}
                </Badge>

                {finding.discipline && DisciplineIcon && (
                  <span className={cn("flex items-center gap-1 text-[10px] font-medium", getDisciplineColor(finding.discipline))}>
                    <DisciplineIcon className="h-3 w-3" />
                    {getDisciplineLabel(finding.discipline)}
                  </span>
                )}

                {conf && ConfIcon && (
                  <span className={cn("flex items-center gap-0.5 text-[10px]", conf.className)}>
                    <ConfIcon className="h-3 w-3" />
                    {conf.label}
                  </span>
                )}

                {finding.county_specific && (
                  <Badge variant="outline" className="text-[9px] font-medium border-accent text-accent bg-accent/5">
                    County Amendment
                  </Badge>
                )}

                {/* Status badge */}
                {status !== "open" && (
                  <Badge variant="outline" className={cn("text-[9px] font-medium", currentStatusOption.className)}>
                    <StatusIcon className="h-2.5 w-2.5 mr-0.5" />
                    {currentStatusOption.label}
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-3">
                <code className="text-[11px] font-mono font-medium text-foreground/80 bg-muted/60 px-1.5 py-0.5 rounded">
                  {finding.code_ref}
                </code>
                {finding.page && (
                  <span className="text-[10px] text-accent font-semibold bg-accent/10 px-1.5 py-0.5 rounded">
                    Sheet: {finding.page}
                  </span>
                )}
              </div>

              <p className="text-sm leading-relaxed text-foreground/90">{finding.description}</p>

              {expanded && finding.recommendation && (
                <div className="mt-2 rounded-md bg-muted/50 border border-border/60 p-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Recommendation</p>
                  <p className="text-sm text-foreground/80 leading-relaxed">{finding.recommendation}</p>
                </div>
              )}

              {!expanded && finding.recommendation && (
                <p className="text-[11px] text-muted-foreground">
                  Click to see recommendation →
                </p>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex flex-col gap-1 shrink-0">
              {finding.markup && onLocateClick && (
                <button
                  className="p-1 rounded-md text-accent/60 hover:text-accent hover:bg-accent/10 transition-colors"
                  onClick={(e) => { e.stopPropagation(); onLocateClick(); }}
                  title="Locate on plan"
                >
                  <MapPin className="h-3.5 w-3.5" />
                </button>
              )}

              {/* Status cycle button */}
              <button
                className={cn("p-1 rounded-md transition-colors", currentStatusOption.className, "hover:bg-muted/50")}
                onClick={(e) => { e.stopPropagation(); cycleStatus(); }}
                title={`Status: ${currentStatusOption.label} — Click to change`}
              >
                <StatusIcon className="h-3.5 w-3.5" />
              </button>

              <button
                className={cn(
                  "p-1 rounded-md transition-colors",
                  flagged ? "text-accent bg-accent/10" : "text-muted-foreground/30 hover:text-muted-foreground/60"
                )}
                onClick={(e) => { e.stopPropagation(); setFlagged(!flagged); }}
                title={flagged ? "Unflag" : "Flag for review"}
              >
                <Flag className="h-3.5 w-3.5" fill={flagged ? "currentColor" : "none"} />
              </button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }
);

FindingCard.displayName = "FindingCard";
