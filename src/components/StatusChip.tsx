import { cn } from "@/lib/utils";

type StatusType =
  | "intake"
  | "plan_review"
  | "in_review"
  | "comments_sent"
  | "resubmitted"
  | "approved"
  | "permit_issued"
  | "inspection_scheduled"
  | "inspection_complete"
  | "certificate_issued"
  | "on_hold"
  | "cancelled"
  | "permitted"
  | "inspection"
  | "complete"
  | "overdue"
  | "pending"
  | "pass"
  | "fail"
  | "partial";

const statusConfig: Record<string, { label: string; color: string }> = {
  intake: { label: "Intake", color: "bg-accent/10 text-accent" },
  plan_review: { label: "Plan Review", color: "bg-teal/10 text-teal" },
  in_review: { label: "In Review", color: "bg-teal/10 text-teal" },
  comments_sent: { label: "Comments Sent", color: "bg-warning/10 text-warning" },
  resubmitted: { label: "Resubmitted", color: "bg-accent/10 text-accent" },
  approved: { label: "Approved", color: "bg-success/10 text-success" },
  permit_issued: { label: "Permit Issued", color: "bg-success/10 text-success" },
  inspection_scheduled: { label: "Inspection Scheduled", color: "bg-teal/10 text-teal" },
  inspection_complete: { label: "Inspection Complete", color: "bg-success/10 text-success" },
  certificate_issued: { label: "Certificate Issued", color: "bg-success/10 text-success" },
  on_hold: { label: "On Hold", color: "bg-warning/10 text-warning" },
  cancelled: { label: "Cancelled", color: "bg-muted text-muted-foreground" },
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
  status: string;
  className?: string;
}

export function StatusChip({ status, className }: StatusChipProps) {
  const config = statusConfig[status] || { label: status.replace(/_/g, " "), color: "bg-muted text-muted-foreground" };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-2 py-0.5 text-xs font-medium capitalize",
        config.color,
        className
      )}
    >
      {config.label}
    </span>
  );
}

export type { StatusType };
