import { cn } from "@/lib/utils";

type StatusType =
  | "intake"
  | "plan_review"
  | "in_review"
  | "comments_sent"
  | "resubmitted"
  | "approved"
  | "permitted"
  | "inspection"
  | "complete"
  | "overdue"
  | "pending"
  | "pass"
  | "fail"
  | "partial";

const statusConfig: Record<StatusType, { label: string; color: string }> = {
  intake: { label: "Intake", color: "bg-accent/10 text-accent" },
  plan_review: { label: "Plan Review", color: "bg-teal/10 text-teal" },
  in_review: { label: "In Review", color: "bg-teal/10 text-teal" },
  comments_sent: { label: "Comments Sent", color: "bg-warning/10 text-warning" },
  resubmitted: { label: "Resubmitted", color: "bg-accent/10 text-accent" },
  approved: { label: "Approved", color: "bg-success/10 text-success" },
  permitted: { label: "Permitted", color: "bg-success/10 text-success" },
  inspection: { label: "Inspection", color: "bg-teal/10 text-teal" },
  complete: { label: "Complete", color: "bg-success/10 text-success" },
  overdue: { label: "Overdue", color: "bg-destructive/10 text-destructive" },
  pending: { label: "Pending", color: "bg-muted text-muted-foreground" },
  pass: { label: "Pass", color: "bg-success/10 text-success" },
  fail: { label: "Fail", color: "bg-destructive/10 text-destructive" },
  partial: { label: "Partial", color: "bg-warning/10 text-warning" },
};

interface StatusChipProps {
  status: StatusType;
  className?: string;
}

export function StatusChip({ status, className }: StatusChipProps) {
  const config = statusConfig[status] || statusConfig.pending;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-2 py-0.5 text-xs font-medium",
        config.color,
        className
      )}
    >
      {config.label}
    </span>
  );
}

export type { StatusType };
