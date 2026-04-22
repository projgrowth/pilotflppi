/**
 * Overall AI confidence meter shown at the top of the findings panel.
 *
 * Rules (per spec):
 *  - >85%  → green
 *  - 60-85% → yellow
 *  - <60%  → red
 *
 * Uses semantic design tokens (success / warning / destructive) so it flips
 * cleanly between light and dark themes — no raw colors here.
 */
import { cn } from "@/lib/utils";

interface ConfidenceMeterProps {
  /** 0-1 average confidence across visible findings. */
  score: number;
  /** Optional sample-size label (e.g. "across 14 findings"). */
  sampleLabel?: string;
  className?: string;
}

export function ConfidenceMeter({ score, sampleLabel, className }: ConfidenceMeterProps) {
  const pct = Math.max(0, Math.min(100, Math.round(score * 100)));
  const tier =
    score > 0.85 ? "high" : score >= 0.6 ? "medium" : "low";

  const barColor =
    tier === "high"
      ? "bg-success"
      : tier === "medium"
        ? "bg-warning"
        : "bg-destructive";

  const labelColor =
    tier === "high"
      ? "text-success"
      : tier === "medium"
        ? "text-warning"
        : "text-destructive";

  const tierLabel =
    tier === "high" ? "High confidence" : tier === "medium" ? "Moderate" : "Low confidence";

  return (
    <div
      className={cn(
        "rounded-md border bg-card px-3 py-2 space-y-1.5",
        className,
      )}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={`Overall AI confidence: ${pct}%`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          AI Confidence
        </span>
        <span className={cn("text-xs font-mono font-semibold tabular-nums", labelColor)}>
          {pct}%
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500 ease-out", barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className={cn("text-2xs font-medium", labelColor)}>{tierLabel}</span>
        {sampleLabel && (
          <span className="text-2xs text-muted-foreground">{sampleLabel}</span>
        )}
      </div>
    </div>
  );
}
