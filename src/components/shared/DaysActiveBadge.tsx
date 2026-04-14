import { cn } from "@/lib/utils";

interface DaysActiveBadgeProps {
  days: number;
  className?: string;
}

export default function DaysActiveBadge({ days, className }: DaysActiveBadgeProps) {
  const style =
    days <= 5
      ? "bg-[hsl(149_60%_95%)] text-status-pass"
      : days <= 10
      ? "bg-[hsl(43_100%_95%)] text-status-minor"
      : "bg-[hsl(1_65%_95%)] text-status-critical";

  return (
    <span className={cn("inline-flex items-center font-mono text-xs font-medium px-2 py-0.5 rounded", style, className)}>
      {days}d
    </span>
  );
}
