import { cn } from "@/lib/utils";

interface DeadlineRingProps {
  daysElapsed: number;
  totalDays?: number;
  size?: number;
  className?: string;
}

export function DeadlineRing({ daysElapsed, totalDays = 21, size = 64, className }: DeadlineRingProps) {
  const remaining = Math.max(0, totalDays - daysElapsed);
  const progress = Math.min(daysElapsed / totalDays, 1);
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - progress);

  const strokeColor =
    remaining <= 3
      ? "hsl(var(--destructive))"
      : remaining <= 6
        ? "hsl(var(--warning))"
        : "hsl(var(--success))";

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--border))"
          strokeWidth={4}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth={4}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <span className="absolute font-mono text-sm font-medium">{remaining}</span>
    </div>
  );
}
