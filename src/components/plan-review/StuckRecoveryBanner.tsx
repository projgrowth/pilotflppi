/**
 * Surfaces the auto-recovery action when the cron job (reconcile-stuck-reviews)
 * has restarted a review that was wedged. Reads `ai_run_progress.auto_recovered_at`
 * — set by the cron — and shows a one-time dismissible note so the reviewer
 * knows their work resumed without having to re-click anything.
 *
 * Pure presentation; no mutation. Dismissed state lives in localStorage so
 * the banner doesn't reappear after a page refresh.
 */
import { useEffect, useState } from "react";
import { CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  planReviewId: string;
  autoRecoveredAt: string | null | undefined;
  recoveredFromStage: string | null | undefined;
  recoveryCount: number | undefined;
}

export function StuckRecoveryBanner({
  planReviewId,
  autoRecoveredAt,
  recoveredFromStage,
  recoveryCount,
}: Props) {
  const dismissKey = autoRecoveredAt
    ? `stuck-recovery-dismissed:${planReviewId}:${autoRecoveredAt}`
    : null;
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!dismissKey) return;
    setDismissed(localStorage.getItem(dismissKey) === "1");
  }, [dismissKey]);

  if (!autoRecoveredAt || dismissed) return null;

  const when = new Date(autoRecoveredAt);
  const whenLabel = when.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs">
      <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-emerald-700 dark:text-emerald-300">
          Pipeline auto-resumed
        </div>
        <div className="mt-0.5 text-muted-foreground">
          We noticed this review was stalled
          {recoveredFromStage ? ` at "${recoveredFromStage.replace(/_/g, " ")}"` : ""} and resumed
          it on {whenLabel}
          {recoveryCount && recoveryCount > 1 ? ` (retry ${recoveryCount})` : ""}.
        </div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="-mr-1 -mt-0.5 h-6 px-1.5 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400"
        onClick={() => {
          if (dismissKey) localStorage.setItem(dismissKey, "1");
          setDismissed(true);
        }}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
