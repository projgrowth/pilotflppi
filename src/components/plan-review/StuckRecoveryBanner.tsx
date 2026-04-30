/**
 * Surfaces four pipeline conditions:
 *  1. Auto-recovery success — cron resumed a stalled review (info, dismissible).
 *  2. needs_user_action — browser-context stage (upload/prepare_pages) couldn't
 *     finish; user needs to re-open the project so pdf.js can finish locally.
 *  3. needs_human_review — pipeline ran but yielded suspiciously low results
 *     (e.g. 0 findings on a multi-page set). Reviewer must decide.
 *  4. needs_preparation — files are uploaded but no `plan_review_page_assets`
 *     rows exist yet, so the pipeline would fail server-side. CTA runs the
 *     in-browser rasterizer.
 *
 * Pure presentation; no mutations beyond the optional onPrepareNow callback.
 * Dismissed state lives in localStorage so the banner doesn't reappear after
 * a page refresh.
 */
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, X, AlertTriangle, AlertCircle, Wand2, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { startPipeline } from "@/lib/pipeline-run";
import { useDeficienciesV2 } from "@/hooks/useReviewDashboard";
import { toast } from "sonner";

interface QualityBreakdown {
  unverified_pct?: number;
  has_hallucinated_citations?: boolean;
  total_live_findings?: number;
  blocker_reason?: string | null;
}

interface Props {
  planReviewId: string;
  autoRecoveredAt: string | null | undefined;
  recoveredFromStage: string | null | undefined;
  recoveryCount: number | undefined;
  aiCheckStatus?: string | null;
  failureReason?: string | null;
  /** Quality breakdown from ai_run_progress so the banner can summarise the
   *  unverified / hallucinated counts and offer targeted re-runs. */
  qualityBreakdown?: QualityBreakdown | null;
  /** True when file_urls.length > 0 but page_assets count === 0. */
  needsPreparation?: boolean;
  onPrepareNow?: () => void;
  preparingNow?: boolean;
  /** Stage that the reconciler parked at when status went to needs_user_action.
   *  Used to pick the right CTA (prepare vs. re-upload). */
  needsUserActionStage?: string | null;
  /** Triggered when stage was 'upload' — opens the file picker. */
  onReuploadFiles?: () => void;
}

export function StuckRecoveryBanner({
  planReviewId,
  autoRecoveredAt,
  recoveredFromStage,
  recoveryCount,
  aiCheckStatus,
  failureReason,
  qualityBreakdown,
  needsPreparation,
  onPrepareNow,
  preparingNow,
  needsUserActionStage,
  onReuploadFiles,
}: Props) {
  const [rerunning, setRerunning] = useState(false);

  // Live breakdown — re-computes whenever the verifier writes back, so the
  // "11 of 11 unverified" banner doesn't sit stale after the verifier finishes.
  // Uses the same realtime-subscribed hook as the dashboard.
  const { data: liveDefs = [] } = useDeficienciesV2(planReviewId);
  const liveBreakdown = useMemo(() => {
    const live = liveDefs.filter(
      (d) =>
        (d.status === "open" || d.status === "needs_info") &&
        d.verification_status !== "superseded" &&
        d.verification_status !== "overturned",
    );
    // Hallucinated citations are auto-hidden from reviewers; exclude them
    // from the denominator too so we don't show "12 of 12 unverified" when
    // every one of those 12 is a fabrication that's already filtered out.
    const real = live.filter((d) => d.citation_status !== "hallucinated");
    const hallucinated = live.length - real.length;
    const verified = real.filter((d) => d.verification_status === "verified" || d.verification_status === "modified").length;
    const needsHuman = real.filter((d) => d.verification_status === "needs_human").length;
    const unverified = real.filter(
      (d) => (d.verification_status ?? "unverified") === "unverified",
    ).length;
    return { total: real.length, verified, needsHuman, unverified, hallucinated };
  }, [liveDefs]);

  const handleRerunVerify = async () => {
    setRerunning(true);
    const r = await startPipeline(planReviewId, "core", "verify");
    setRerunning(false);
    if (r.ok) toast.success("Verifier re-run started");
    else toast.error(r.message ?? "Could not start verifier");
  };
  const dismissKey = autoRecoveredAt
    ? `stuck-recovery-dismissed:${planReviewId}:${autoRecoveredAt}`
    : null;
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!dismissKey) {
      setDismissed(false);
      return;
    }
    setDismissed(localStorage.getItem(dismissKey) === "1");
  }, [dismissKey]);

  // ---- needs_preparation variant (highest priority — blocks pipeline) ----
  if (needsPreparation && onPrepareNow) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs">
        <AlertTriangle className="h-4 w-4 flex-shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-warning-foreground">
            This review hasn't been prepared yet
          </div>
          <div className="mt-0.5 text-muted-foreground">
            Files are uploaded but pages haven't been rasterized. Click below
            to prepare them in your browser, then the pipeline can run.
          </div>
        </div>
        <Button
          size="sm"
          variant="default"
          onClick={onPrepareNow}
          disabled={preparingNow}
          className="h-7 shrink-0 text-2xs"
        >
          {preparingNow ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <Wand2 className="mr-1 h-3 w-3" />
          )}
          {preparingNow ? "Preparing…" : "Prepare pages now"}
        </Button>
      </div>
    );
  }

  // ---- needs_user_action variant (not dismissible — blocks progress) ----
  if (aiCheckStatus === "needs_user_action") {
    return (
      <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs">
        <AlertTriangle className="h-4 w-4 flex-shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-warning-foreground">
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
    // Prefer the LIVE breakdown over the snapshot in ai_run_progress —
    // otherwise the banner shows "11 of 11 unverified" forever even after
    // the verifier finishes (stale snapshot bug).
    const total = liveBreakdown.total || (qualityBreakdown?.total_live_findings ?? 0);
    const unverifiedCount = liveBreakdown.unverified;
    const unverifiedPct = total > 0 ? Math.round((unverifiedCount / total) * 100) : 0;
    const hasHallucinated = !!qualityBreakdown?.has_hallucinated_citations;
    const showRerun = unverifiedCount > 0;
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
        <AlertCircle className="h-4 w-4 flex-shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-destructive">Manual review required</div>
          <div className="mt-0.5 text-muted-foreground">
            {qualityBreakdown?.blocker_reason ?? failureReason ??
              "The automated pipeline finished but produced unusually low results. Please review manually before sending."}
          </div>
          {total > 0 && (
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-muted-foreground">
              <span>{liveBreakdown.verified} verified by adversarial AI</span>
              {liveBreakdown.needsHuman > 0 && (
                <span>· {liveBreakdown.needsHuman} need your eyes</span>
              )}
              {unverifiedCount > 0 && (
                <span>· {unverifiedCount} awaiting verifier ({unverifiedPct}%)</span>
              )}
              {hasHallucinated && <span>· hallucinated citations auto-hidden</span>}
            </div>
          )}
        </div>
        {showRerun && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleRerunVerify}
            disabled={rerunning}
            className="h-7 shrink-0 text-2xs"
          >
            {rerunning ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-3 w-3" />
            )}
            {rerunning ? "Starting…" : "Re-run verifier"}
          </Button>
        )}
      </div>
    );
  }

  // ---- auto-recovery success variant (dismissible) ----
  if (!autoRecoveredAt || dismissed) return null;

  const when = new Date(autoRecoveredAt);
  const whenLabel = when.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-xs">
      <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-success" />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-success">
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
        className="-mr-1 -mt-0.5 h-6 px-1.5 text-success hover:bg-success/10"
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
