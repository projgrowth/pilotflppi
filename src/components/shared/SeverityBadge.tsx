import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type SeverityLevel = "critical" | "major" | "minor" | "admin" | "pass";

interface SeverityBadgeProps {
  level: SeverityLevel;
  count?: number;
  className?: string;
}

export default function SeverityBadge({ level, count, className }: SeverityBadgeProps) {
  const label = count !== undefined ? `${level} • ${count}` : level;
  return (
    <span className={cn(`badge-${level}`, className)}>
      {label}
    </span>
  );
}
