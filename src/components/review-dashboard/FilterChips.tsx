/**
 * FilterChips — inline filter chip strip for the All-Findings tab.
 *
 * Replaces the demoted Human Review and Deferred Scope tabs. Each chip
 * pre-filters the same `DeficiencyList` instead of swapping surfaces.
 */
import { cn } from "@/lib/utils";
import { AlertTriangle, Eye, Clock, Layers } from "lucide-react";

export type FilterChipKey = "all" | "needs-eyes" | "life-safety" | "low-confidence" | "deferred";

interface ChipDef {
  key: FilterChipKey;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  count: number;
}

interface Props {
  active: FilterChipKey;
  onChange: (key: FilterChipKey) => void;
  counts: {
    all: number;
    needsEyes: number;
    lifeSafety: number;
    lowConfidence: number;
    deferred: number;
  };
}

export default function FilterChips({ active, onChange, counts }: Props) {
  const chips: ChipDef[] = [
    { key: "all", label: "All", count: counts.all },
    { key: "needs-eyes", label: "Needs eyes", icon: Eye, count: counts.needsEyes },
    { key: "life-safety", label: "Life safety", icon: AlertTriangle, count: counts.lifeSafety },
    { key: "low-confidence", label: "Low confidence", icon: Clock, count: counts.lowConfidence },
    { key: "deferred", label: "Deferred", icon: Layers, count: counts.deferred },
  ];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => {
        const Icon = c.icon;
        const isActive = active === c.key;
        const dim = c.count === 0 && c.key !== "all";
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => onChange(c.key)}
            disabled={dim}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-medium transition-colors",
              isActive
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground",
              dim && "opacity-40",
            )}
          >
            {Icon && <Icon className="h-3 w-3" />}
            {c.label}
            <span
              className={cn(
                "rounded-full px-1.5 font-mono text-2xs",
                isActive ? "bg-primary-foreground/20" : "bg-muted text-foreground/70",
              )}
            >
              {c.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
