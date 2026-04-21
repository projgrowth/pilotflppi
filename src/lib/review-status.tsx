// Shared review-status logic: dashboard pill ↔ generated PDF report must agree.
import { cn } from "@/lib/utils";

export type ReviewStatus =
  | "approved"
  | "approved_with_conditions"
  | "revise_resubmit"
  | "incomplete";

interface DefForStatus {
  life_safety_flag: boolean;
  permit_blocker: boolean;
  priority: string;
  status: string;
  requires_human_review: boolean;
  // Optional — filtered out before status calc when present.
  verification_status?: string;
}

/**
 * Single source of truth for "what status is this review in?"
 * Used by both the dashboard StatusPill and the generated county PDF.
 */
export function determineReviewStatus(defs: DefForStatus[]): ReviewStatus {
  // Overturned/superseded items don't count — they failed adversarial verification or were merged as duplicates.
  const live = defs.filter(
    (d) =>
      d.verification_status !== "overturned" &&
      d.verification_status !== "superseded",
  );

  const unresolvedHumanReview = live.some(
    (d) => d.requires_human_review && d.status === "open",
  );
  if (unresolvedHumanReview) return "incomplete";

  const unresolvedHigh = live.some(
    (d) => d.priority === "high" && d.status !== "resolved" && d.status !== "waived",
  );
  if (unresolvedHigh) return "revise_resubmit";

  const unresolvedBlocker = live.some(
    (d) =>
      (d.life_safety_flag || d.permit_blocker) &&
      d.status !== "resolved" &&
      d.status !== "waived",
  );
  if (unresolvedBlocker) return "revise_resubmit";

  const openMedium = live.some(
    (d) => d.priority === "medium" && d.status === "open",
  );
  if (openMedium) return "approved_with_conditions";

  return "approved";
}

export const REVIEW_STATUS_LABELS: Record<
  ReviewStatus,
  { label: string; cls: string }
> = {
  approved: {
    label: "Approved",
    cls: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400",
  },
  approved_with_conditions: {
    label: "Approved with Conditions",
    cls: "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400",
  },
  revise_resubmit: {
    label: "Revise & Resubmit",
    cls: "bg-destructive/10 text-destructive border-destructive/30",
  },
  incomplete: {
    label: "Incomplete Review",
    cls: "bg-muted text-foreground border-border",
  },
};

export function StatusPill({
  status,
  className,
}: {
  status: ReviewStatus;
  className?: string;
}) {
  const cfg = REVIEW_STATUS_LABELS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium",
        cfg.cls,
        className,
      )}
    >
      {cfg.label}
    </span>
  );
}
