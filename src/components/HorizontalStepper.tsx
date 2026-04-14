import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

interface Step {
  key: string;
  label: string;
}

interface HorizontalStepperProps {
  steps: Step[];
  currentStepIndex: number;
  className?: string;
}

export function HorizontalStepper({ steps, currentStepIndex, className }: HorizontalStepperProps) {
  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-center">
        {steps.map((step, i) => {
          const isComplete = i < currentStepIndex;
          const isCurrent = i === currentStepIndex;

          return (
            <div key={step.key} className="flex items-center flex-1 last:flex-none">
              {/* Step dot */}
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={cn(
                    "h-7 w-7 rounded-full flex items-center justify-center text-2xs font-semibold transition-all shrink-0",
                    isComplete
                      ? "bg-success text-success-foreground"
                      : isCurrent
                        ? "bg-accent text-accent-foreground ring-[3px] ring-accent/20"
                        : "bg-muted text-muted-foreground"
                  )}
                >
                  {isComplete ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </div>
                <span
                  className={cn(
                    "text-2xs font-medium whitespace-nowrap",
                    isComplete
                      ? "text-success"
                      : isCurrent
                        ? "text-foreground"
                        : "text-muted-foreground"
                  )}
                >
                  {step.label}
                </span>
              </div>

              {/* Connector line */}
              {i < steps.length - 1 && (
                <div
                  className={cn(
                    "flex-1 h-0.5 mx-1.5 rounded-full mt-[-18px]",
                    isComplete ? "bg-success" : "bg-border"
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
