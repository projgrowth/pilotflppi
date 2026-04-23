/**
 * DashboardAlertStack — single-slot, prioritized alert surface.
 *
 * Replaces the four-stacked-banner stack on `ReviewDashboard` (re-prepare,
 * DNA, citation DB, letter quality). Renders ONE alert at a time using a
 * stable severity priority. Additional alerts collapse into a "+N more"
 * popover so the page lands on findings, not on a wall of meta.
 *
 * Each alert is a self-contained record produced by the dashboard from
 * existing hook state — no new data sources.
 */
import { useState } from "react";
import {
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Info,
  ShieldOff,
  Wand2,
  Loader2,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type AlertSeverity = "danger" | "warn" | "info";

export interface DashboardAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  description?: string;
  /** Action label, shown inline on the primary alert. */
  actionLabel?: string;
  /** Click handler for the action. */
  onAction?: () => void;
  /** Spinner while the action is running. */
  busy?: boolean;
  /** Optional icon override. */
  icon?: LucideIcon;
}

interface Props {
  alerts: DashboardAlert[];
}

const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  danger: 0,
  warn: 1,
  info: 2,
};

const SEVERITY_ICON: Record<AlertSeverity, LucideIcon> = {
  danger: ShieldOff,
  warn: AlertTriangle,
  info: Info,
};

const SEVERITY_CLS: Record<AlertSeverity, string> = {
  danger: "border-destructive/40 bg-destructive/5 text-destructive",
  warn: "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400",
  info: "border-border bg-muted/40 text-muted-foreground",
};

export default function DashboardAlertStack({ alerts }: Props) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  if (alerts.length === 0) return null;

  // Sort by severity, keep insertion order within a severity group.
  const sorted = [...alerts].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
  const [primary, ...rest] = sorted;
  const Icon = primary.icon ?? SEVERITY_ICON[primary.severity];

  return (
    <div className={cn("flex items-start gap-3 rounded-lg border p-3", SEVERITY_CLS[primary.severity])}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{primary.title}</div>
        {primary.description && (
          <div className="mt-0.5 text-xs text-foreground/80">{primary.description}</div>
        )}
      </div>
      {primary.actionLabel && primary.onAction && (
        <Button
          size="sm"
          variant={primary.severity === "danger" ? "default" : "secondary"}
          onClick={primary.onAction}
          disabled={primary.busy}
          className="shrink-0"
        >
          {primary.busy ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Wand2 className="mr-1 h-4 w-4" />
          )}
          {primary.actionLabel}
        </Button>
      )}
      {rest.length > 0 && (
        <Popover open={overflowOpen} onOpenChange={setOverflowOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="ghost" className="shrink-0 text-xs">
              +{rest.length} more
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-96 p-2">
            <div className="space-y-1">
              {rest.map((a) => {
                const ItemIcon = a.icon ?? SEVERITY_ICON[a.severity];
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      a.onAction?.();
                      setOverflowOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-md border p-2 text-left text-xs transition-colors hover:bg-muted/50",
                      a.severity === "danger" && "border-destructive/30",
                      a.severity === "warn" && "border-amber-500/30",
                      a.severity === "info" && "border-border",
                    )}
                  >
                    <ItemIcon
                      className={cn(
                        "mt-0.5 h-3.5 w-3.5 shrink-0",
                        a.severity === "danger" && "text-destructive",
                        a.severity === "warn" && "text-amber-600 dark:text-amber-400",
                        a.severity === "info" && "text-muted-foreground",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{a.title}</div>
                      {a.description && (
                        <div className="mt-0.5 text-muted-foreground line-clamp-2">
                          {a.description}
                        </div>
                      )}
                    </div>
                    {a.actionLabel && (
                      <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60" />
                    )}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

/** Small helper to build alert objects from existing dashboard state. */
export function makeAlert(
  id: string,
  severity: AlertSeverity,
  title: string,
  opts: Partial<Omit<DashboardAlert, "id" | "severity" | "title">> = {},
): DashboardAlert {
  return { id, severity, title, ...opts };
}

export { AlertCircle, CheckCircle2 };
