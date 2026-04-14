import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";

interface ConfidenceBarProps {
  score: number;
  animated?: boolean;
  className?: string;
}

export default function ConfidenceBar({ score, animated = false, className }: ConfidenceBarProps) {
  const [width, setWidth] = useState(animated ? 0 : score * 100);
  const color = score > 0.85 ? "hsl(var(--conf-high))" : score >= 0.6 ? "hsl(var(--conf-medium))" : "hsl(var(--conf-low))";

  useEffect(() => {
    if (animated) {
      const t = setTimeout(() => setWidth(score * 100), 50);
      return () => clearTimeout(t);
    }
  }, [score, animated]);

  return (
    <div className={cn("h-1 w-full rounded-full bg-fpp-gray-100", className)}>
      <div
        className="h-full rounded-full"
        style={{
          width: `${width}%`,
          backgroundColor: color,
          transition: animated ? "width 600ms ease-out" : undefined,
        }}
      />
    </div>
  );
}
