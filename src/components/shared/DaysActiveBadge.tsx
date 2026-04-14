import { cn } from "@/lib/utils";

interface DaysActiveBadgeProps {
  days: number;
  className?: string;
}

export default function DaysActiveBadge({ days, className }: DaysActiveBadgeProps) {
  const style =
    days <= 5
      ? "bg-success-bg text-status-pass"
      : days <= 10
      ? "bg-warning-bg text-status-minor"
      : "bg-destructive-bg text-status-critical";

  return (
    <span className={cn("inline-flex items-center font-mono text-xs font-medium px-2 py-0.5 rounded", style, className)}>
      {days}d
    </span>
  );
}
