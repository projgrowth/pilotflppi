import { cn } from "@/lib/utils";

interface SeverityDonutProps {
  critical: number;
  major: number;
  minor: number;
  size?: number;
  className?: string;
}

export function SeverityDonut({ critical, major, minor, size = 64, className }: SeverityDonutProps) {
  const total = critical + major + minor;
  if (total === 0) return null;

  const radius = 24;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  const critPct = critical / total;
  const majPct = major / total;
  const minPct = minor / total;

  const critLen = critPct * circumference;
  const majLen = majPct * circumference;
  const minLen = minPct * circumference;

  const critOffset = 0;
  const majOffset = -(critLen);
  const minOffset = -(critLen + majLen);

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        {/* Minor (base) */}
        {minor > 0 && (
          <circle
            cx={center} cy={center} r={radius}
            fill="none"
            strokeWidth={8}
            className="stroke-muted-foreground/30"
            strokeDasharray={`${minLen} ${circumference - minLen}`}
            strokeDashoffset={minOffset}
            strokeLinecap="round"
          />
        )}
        {/* Major */}
        {major > 0 && (
          <circle
            cx={center} cy={center} r={radius}
            fill="none"
            strokeWidth={8}
            className="stroke-[hsl(var(--warning))]"
            strokeDasharray={`${majLen} ${circumference - majLen}`}
            strokeDashoffset={majOffset}
            strokeLinecap="round"
          />
        )}
        {/* Critical */}
        {critical > 0 && (
          <circle
            cx={center} cy={center} r={radius}
            fill="none"
            strokeWidth={8}
            className="stroke-destructive"
            strokeDasharray={`${critLen} ${circumference - critLen}`}
            strokeDashoffset={critOffset}
            strokeLinecap="round"
          />
        )}
      </svg>
      <span className="absolute text-xs font-bold text-foreground">{total}</span>
    </div>
  );
}
