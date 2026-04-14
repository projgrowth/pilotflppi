import { cn } from "@/lib/utils";

type ConfidenceLevel = "high" | "medium" | "low";

const labels: Record<ConfidenceLevel, string> = {
  high: "High Confidence",
  medium: "Verify Recommended",
  low: "Manual Review Required",
};

interface ConfidenceBadgeProps {
  level: ConfidenceLevel;
  showLabel?: boolean;
  className?: string;
}

export default function ConfidenceBadge({ level, showLabel = true, className }: ConfidenceBadgeProps) {
  if (!showLabel) {
    return (
      <span
        className={cn("inline-block h-2 w-2 rounded-full", className)}
        style={{ backgroundColor: level === "high" ? "hsl(var(--conf-high))" : level === "medium" ? "hsl(var(--conf-medium))" : "hsl(var(--conf-low))" }}
      />
    );
  }
  return (
    <span className={cn(`badge-conf-${level}`, "font-mono text-[11px] font-medium px-2 py-0.5 rounded", className)}>
      {labels[level]}
    </span>
  );
}
