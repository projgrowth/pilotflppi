/**
 * AnalyzingHero — full-width "we're working on your plans" card for the
 * Review Dashboard. Shown while the pipeline is in flight (or the user just
 * landed from NewReviewDialog and stage rows haven't appeared yet).
 *
 * Wraps the existing PipelineProgressStepper so the dashboard has ONE
 * authoritative live view of the run instead of relying on the workspace's
 * canvas overlay.
 *
 * Design rules respected:
 *  - No animate-spin inside the persistent surface (memory: "static accent
 *    borders for urgent notifications, never animations"). A static dot +
 *    the stage stepper's own progress communicate liveness.
 *  - Elapsed/ETA anchored on the earliest pipeline_status.started_at so
 *    navigating back doesn't reset the clock to 0:00.
 */
import { useEffect, useState } from "react";
import { ShieldCheck, FileText, XCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { PipelineProgressStepper } from "@/components/plan-review/PipelineProgressStepper";

interface Props {
  planReviewId: string;
  pendingFileCount?: number;
  pendingPageCount?: number;
  preparedPages?: number;
  expectedPages?: number;
  /** True when the pipeline has at least one stage row writing progress. */
  pipelineActive: boolean;
  /**
   * Earliest pipeline_status.started_at across all rows for this run.
   * When provided we anchor the elapsed/remaining clock here so that
   * remounting the hero (e.g. via tab change) doesn't restart the timer.
   * When null, we fall back to the time the component first mounted.
   */
  pipelineStartedAt?: string | null;
  onComplete?: () => void;
  onCancel?: () => void;
}

const ANALYZE_TARGET_MS = 3 * 60_000;

export function AnalyzingHero({
  planReviewId,
  pendingFileCount,
  pendingPageCount,
  preparedPages,
  expectedPages,
  pipelineActive,
  pipelineStartedAt,
  onComplete,
  onCancel,
}: Props) {
  // Anchor on the DB timestamp when available so a back-nav doesn't reset
  // the elapsed counter. Mount-time is only the fallback for the brief
  // "just-created" window before any stage row exists.
  const [mountAnchor] = useState<number>(() => Date.now());
  const startedAt = pipelineStartedAt
    ? new Date(pipelineStartedAt).getTime()
    : mountAnchor;

  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsed = Math.max(0, Date.now() - startedAt);
  const remaining = Math.max(0, ANALYZE_TARGET_MS - elapsed);
  const fmt = (ms: number) => {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
  };

  const showPrep =
    !pipelineActive && typeof expectedPages === "number" && expectedPages > 0;
  const prepPct =
    showPrep && expectedPages
      ? Math.min(100, Math.round(((preparedPages ?? 0) / expectedPages) * 100))
      : 0;

  const subtitle = (() => {
    if (pipelineActive) return "AI review in progress. Safe to close — analysis runs in the background.";
    if (showPrep) return "Preparing pages in your browser before the AI can read them. Keep this tab open.";
    if (pendingFileCount && pendingPageCount) {
      return `Reviewing ${pendingPageCount} sheet${pendingPageCount === 1 ? "" : "s"} across ${pendingFileCount} PDF${pendingFileCount === 1 ? "" : "s"}.`;
    }
    return "Getting your review ready…";
  })();

  return (
    <div className="rounded-xl border border-accent/40 bg-accent/5 p-5 shadow-sm">
      <div className="flex items-start gap-3">
        {/* Static accent dot — communicates "live" without the anxiety
            of a 3-minute spinner. */}
        <span
          className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-accent"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">
              Analyzing your plans
            </h2>
            {pipelineActive && (
              <span className="font-mono text-2xs tabular-nums text-muted-foreground">
                {fmt(elapsed)} elapsed · ~{fmt(remaining)} left
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>

      {showPrep && (
        <div className="mt-4 space-y-1">
          <div className="flex items-center justify-between text-2xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <FileText className="h-3 w-3" />
              Preparing pages — {preparedPages ?? 0} / {expectedPages}
            </span>
            <span className="font-mono tabular-nums">{prepPct}%</span>
          </div>
          <Progress value={prepPct} className="h-1.5" />
        </div>
      )}

      {pipelineActive && (
        <div className="mt-4">
          <PipelineProgressStepper
            planReviewId={planReviewId}
            compact
            mode="core"
            onComplete={onComplete}
          />
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 rounded-md border border-border/60 bg-card/60 px-2 py-1.5 text-2xs text-muted-foreground">
          <ShieldCheck className="h-3 w-3 text-accent" />
          Findings will appear below as soon as they're ready — no need to refresh.
        </p>
        {pipelineActive && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-1 text-2xs font-medium text-muted-foreground transition-colors hover:text-destructive"
          >
            <XCircle className="h-3 w-3" />
            Cancel run
          </button>
        )}
      </div>
    </div>
  );
}
