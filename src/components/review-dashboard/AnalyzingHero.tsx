/**
 * AnalyzingHero — full-width "we're working on your plans" card for the
 * Review Dashboard. Shown while the pipeline is in flight (or the user just
 * landed from NewReviewDialog and stage rows haven't appeared yet).
 *
 * Wraps the existing PipelineProgressStepper so the dashboard has ONE
 * authoritative live view of the run instead of relying on the workspace's
 * canvas overlay.
 */
import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, FileText } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { PipelineProgressStepper } from "@/components/plan-review/PipelineProgressStepper";

interface Props {
  planReviewId: string;
  /** Summary text under the headline. */
  pendingFileCount?: number;
  pendingPageCount?: number;
  preparedPages?: number;
  expectedPages?: number;
  /** True when the pipeline has at least one stage row writing progress. */
  pipelineActive: boolean;
  onComplete?: () => void;
}

const ANALYZE_TARGET_MS = 3 * 60_000;

export function AnalyzingHero({
  planReviewId,
  pendingFileCount,
  pendingPageCount,
  preparedPages,
  expectedPages,
  pipelineActive,
  onComplete,
}: Props) {
  const [startedAt] = useState<number>(() => Date.now());
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsed = Date.now() - startedAt;
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
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-accent" />
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

      <p className="mt-4 flex items-center gap-1.5 rounded-md border border-border/60 bg-card/60 px-2 py-1.5 text-2xs text-muted-foreground">
        <ShieldCheck className="h-3 w-3 text-accent" />
        Findings will appear below as soon as they're ready — no need to refresh.
      </p>
    </div>
  );
}
