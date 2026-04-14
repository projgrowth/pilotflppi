import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

type Stage = "intake" | "ai_scan" | "under_review" | "comments_sent" | "resubmittal" | "approved";

const stages: { key: Stage; label: string }[] = [
  { key: "intake", label: "Intake" },
  { key: "ai_scan", label: "AI Scan" },
  { key: "under_review", label: "Under Review" },
  { key: "comments_sent", label: "Comments Sent" },
  { key: "resubmittal", label: "Resubmittal" },
  { key: "approved", label: "Approved" },
];

interface ReviewStagePipelineProps {
  currentStage: Stage;
  compact?: boolean;
  className?: string;
}

export default function ReviewStagePipeline({ currentStage, compact = false, className }: ReviewStagePipelineProps) {
  const currentIdx = stages.findIndex((s) => s.key === currentStage);

  if (compact) {
    const stage = stages[currentIdx] || stages[0];
    return (
      <span className="badge-admin font-mono text-xs">
        {stage.label}
      </span>
    );
  }

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {stages.map((stage, i) => {
        const isCompleted = i < currentIdx;
        const isCurrent = i === currentIdx;
        const isUpcoming = i > currentIdx;

        return (
          <div key={stage.key} className="flex items-center">
            {i > 0 && (
              <div
                className={cn(
                  "h-px w-4 mx-0.5",
                  isCompleted || isCurrent ? "bg-primary" : "bg-fpp-gray-100"
                )}
              />
            )}
            <div className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-2xs",
                  isCompleted && "bg-primary text-primary-foreground",
                  isCurrent && "bg-primary text-primary-foreground animate-pulse",
                  isUpcoming && "border border-fpp-gray-100 text-fpp-gray-400"
                )}
              >
                {isCompleted ? <Check className="h-3 w-3" /> : <span>{i + 1}</span>}
              </div>
              <span
                className={cn(
                  "text-2xs font-sans whitespace-nowrap",
                  isCurrent ? "text-foreground font-medium" : "text-fpp-gray-400"
                )}
              >
                {stage.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
