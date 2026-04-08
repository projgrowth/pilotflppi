import { cn } from "@/lib/utils";
import { Check, Loader2 } from "lucide-react";
import { getDisciplineIcon, getDisciplineColor, SCANNING_STEPS } from "@/lib/county-utils";

interface ScanTimelineProps {
  currentStep: number;
  className?: string;
}

export function ScanTimeline({ currentStep, className }: ScanTimelineProps) {
  return (
    <div className={cn("space-y-1", className)}>
      {SCANNING_STEPS.map((step, i) => {
        const Icon = getDisciplineIcon(step.discipline);
        const active = i === currentStep;
        const done = i < currentStep;

        return (
          <div
            key={step.discipline}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 transition-all duration-500",
              active && "bg-accent/10 scale-[1.02]",
              done && "opacity-70",
              !active && !done && "opacity-30"
            )}
          >
            {/* Status indicator */}
            <div className={cn(
              "h-6 w-6 rounded-full flex items-center justify-center shrink-0 transition-all duration-500",
              done && "bg-[hsl(var(--success))]/15",
              active && "bg-accent/15",
              !active && !done && "bg-muted"
            )}>
              {done ? (
                <Check className="h-3.5 w-3.5 text-[hsl(var(--success))]" />
              ) : active ? (
                <Loader2 className="h-3.5 w-3.5 text-accent animate-spin" />
              ) : (
                <Icon className="h-3 w-3 text-muted-foreground/50" />
              )}
            </div>

            {/* Label */}
            <div className="flex-1 min-w-0">
              <p className={cn(
                "text-xs font-medium transition-colors",
                active && "text-accent",
                done && "text-[hsl(var(--success))]",
                !active && !done && "text-muted-foreground/50"
              )}>
                {step.label}
              </p>
            </div>

            {/* Discipline icon */}
            <Icon className={cn(
              "h-3.5 w-3.5 shrink-0 transition-all",
              active && getDisciplineColor(step.discipline),
              done && "text-[hsl(var(--success))]/60",
              !active && !done && "text-muted-foreground/20"
            )} />
          </div>
        );
      })}
    </div>
  );
}
