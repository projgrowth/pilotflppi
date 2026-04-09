import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";

interface DeadlineBarProps {
  daysElapsed: number;
  totalDays?: number;
  className?: string;
  /** When true, shows "Business Day X/Y" labels for F.S. 553.791 statutory tracking */
  statutory?: boolean;
  label?: string;
}

export function DeadlineBar({ daysElapsed, totalDays = 21, className, statutory, label }: DeadlineBarProps) {
  const remaining = Math.max(0, totalDays - daysElapsed);
  const progress = Math.min((daysElapsed / totalDays) * 100, 100);

  const colorClass =
    remaining <= 3
      ? "[&>div]:bg-destructive"
      : remaining <= 6
        ? "[&>div]:bg-[hsl(var(--warning))]"
        : "[&>div]:bg-success";

  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
      )}
      <div className="flex items-center justify-between">
        <span className={cn(
          "text-sm font-semibold font-mono",
          remaining <= 0 ? "text-destructive animate-pulse" : remaining <= 3 ? "text-destructive" : remaining <= 6 ? "text-[hsl(var(--warning))]" : "text-success"
        )}>
          {remaining <= 0 ? "OVERDUE" : `${remaining} ${statutory ? "biz" : ""} days left`}
        </span>
        <span className="text-[10px] text-muted-foreground font-mono">
          {statutory ? "Biz Day" : "Day"} {Math.min(daysElapsed, totalDays)}/{totalDays}
        </span>
      </div>
      <Progress value={progress} className={cn("h-2", colorClass, remaining <= 1 && "animate-pulse")} />
    </div>
  );
}
