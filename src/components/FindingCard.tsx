import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getDisciplineIcon, getDisciplineColor, getDisciplineLabel } from "@/lib/county-utils";
import { AlertTriangle, AlertCircle, Info, CheckCircle2, HelpCircle, Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

export interface Finding {
  severity: string;
  discipline?: string;
  code_ref: string;
  county_specific?: boolean;
  page: string;
  description: string;
  recommendation: string;
  confidence?: string;
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

export function FindingCard({ finding, index, globalIndex }: { finding: Finding; index: number; globalIndex?: number }) {
  const [expanded, setExpanded] = useState(false);
  const [flagged, setFlagged] = useState(false);
  const sev = severityConfig[finding.severity] || severityConfig.minor;
  const SevIcon = sev.icon;
  const conf = finding.confidence ? confidenceConfig[finding.confidence] : null;
  const ConfIcon = conf?.icon;
  const DisciplineIcon = finding.discipline ? getDisciplineIcon(finding.discipline) : null;

  const displayIndex = globalIndex !== undefined ? globalIndex : index;

  return (
    <Card
      className={cn(
        "shadow-subtle border overflow-hidden cursor-pointer transition-all hover:shadow-md",
        "relative",
        flagged && "ring-1 ring-accent/50"
      )}
      onClick={() => setExpanded(!expanded)}
    >
      {/* Severity left bar */}
      <div className={cn("absolute left-0 top-0 bottom-0 w-1", sev.bar)} />

      <CardContent className="p-4 pl-5">
        <div className="flex items-start gap-3">
          {/* Finding index */}
          <span className="text-[10px] font-mono font-bold text-muted-foreground/60 mt-1 shrink-0 w-5 text-right">
            #{displayIndex + 1}
          </span>

          {/* Severity icon */}
          <div className={cn("rounded-md p-1.5 shrink-0 mt-0.5", sev.badge)}>
            <SevIcon className="h-3.5 w-3.5" />
          </div>

          <div className="flex-1 min-w-0 space-y-1.5">
            {/* Top badges row */}
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
            </div>

            {/* Code ref + page */}
            <div className="flex items-center gap-3">
              <code className="text-[11px] font-mono font-medium text-foreground/80 bg-muted/60 px-1.5 py-0.5 rounded">
                {finding.code_ref}
              </code>
              {finding.page && (
                <span className="text-[10px] text-accent font-semibold bg-accent/10 px-1.5 py-0.5 rounded">
                  📄 Sheet: {finding.page}
                </span>
              )}
            </div>

            {/* Description */}
            <p className="text-sm leading-relaxed text-foreground/90">{finding.description}</p>

            {/* Recommendation (expandable) */}
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

          {/* Flag for review */}
          <button
            className={cn(
              "shrink-0 mt-1 p-1 rounded-md transition-colors",
              flagged ? "text-accent bg-accent/10" : "text-muted-foreground/30 hover:text-muted-foreground/60"
            )}
            onClick={(e) => { e.stopPropagation(); setFlagged(!flagged); }}
            title={flagged ? "Unflag" : "Flag for review"}
          >
            <Flag className="h-3.5 w-3.5" fill={flagged ? "currentColor" : "none"} />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
