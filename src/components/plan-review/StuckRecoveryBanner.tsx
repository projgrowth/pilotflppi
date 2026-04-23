/**
 * Surfaces three pipeline conditions:
 *  1. Auto-recovery success — cron resumed a stalled review (info, dismissible).
 *  2. needs_user_action — browser-context stage (upload/prepare_pages) couldn't
 *     finish; user needs to re-open the project so pdf.js can finish locally.
 *  3. needs_human_review — pipeline ran but yielded suspiciously low results
 *     (e.g. 0 findings on a multi-page set). Reviewer must decide.
 *
 * Pure presentation; no mutations. Dismissed state lives in localStorage so
 * the banner doesn't reappear after a page refresh.
 */
import { useEffect, useState } from "react";
import { CheckCircle2, X, AlertTriangle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  planReviewId: string;
  autoRecoveredAt: string | null | undefined;
  recoveredFromStage: string | null | undefined;
  recoveryCount: number | undefined;
  aiCheckStatus?: string | null;
  failureReason?: string | null;
}

export function StuckRecoveryBanner({
  planReviewId,
  autoRecoveredAt,
  recoveredFromStage,
  recoveryCount,
  aiCheckStatus,
  failureReason,
}: Props) {
  // ---- needs_user_action variant (not dismissible — blocks progress) ----
  if (aiCheckStatus === "needs_user_action") {
    return (
      <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">
        <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-amber-700 dark:text-amber-300">
            Action needed: finish preparing pages
          </div>
          <div className="mt-0.5 text-muted-foreground">
            {failureReason ??
              "Page preparation didn't finish. Re-open this project so your browser can finish rendering the plan pages."}
          </div>
        </div>
      </div>
    );
  }

  // ---- needs_human_review variant (not dismissible — needs disposition) ----
  if (aiCheckStatus === "needs_human_review") {
    return (
      <div className="flex items-start gap-2 rounded-md border border-orange-500/40 bg-orange-500/5 px-3 py-2 text-xs">
        <AlertCircle className="h-4 w-4 flex-shrink-0 text-orange-600 dark:text-orange-400" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-orange-700 dark:text-orange-300">
            Manual review required
          </div>
          <div className="mt-0.5 text-muted-foreground">
            {failureReason ??
              "The automated pipeline finished but produced unusually low results. Please review manually before sending."}
          </div>
        </div>
      </div>
    );
  }

  // ---- auto-recovery success variant (dismissible) ----
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
