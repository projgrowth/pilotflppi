/**
 * Full-canvas "we're working on your plans" surface.
 *
 * Owns every pre-ready phase so the user never sees the empty drop zone or a
 * tiny spinner after Create Project:
 *
 *   bootstrapping  → "Getting your review ready" (review just created)
 *   uploading      → "Uploading PDFs" with X/N pages prepared
 *   preparing      → "Preparing pages X / N" (browser rasterization)
 *   analyzing      → live pipeline stepper (existing behavior)
 *
 * Reuses PipelineProgressStepper for stage-level state once the pipeline has
 * actually started. Before that, we render an upload/prep summary so the page
 * has continuous motion from second one.
 */
import { useEffect, useState } from "react";
import { Loader2, ExternalLink, FileText, CheckCircle2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { PipelineProgressStepper } from "@/components/plan-review/PipelineProgressStepper";

export type ProcessingPhase = "bootstrapping" | "uploading" | "preparing" | "analyzing";

interface Props {
  planReviewId: string;
  phase: ProcessingPhase;
  /** Page-prep counters (browser rasterization). */
  preparedPages?: number;
  expectedPages?: number;
  /** File counters during the bootstrapping/uploading window. */
  fileCount?: number;
  /** Optional context shown during the bootstrapping phase to reflect the data the user just typed. */
  projectName?: string;
  fileNames?: string[];
  onOpenDashboard?: () => void;
  /** Fired exactly once when the terminal stage lands. */
  onComplete?: () => void;
}

// Typical end-to-end pipeline runtime, used for a soft ETA while analyzing.
const ANALYZE_TARGET_MS = 3 * 60_000;

export function ProcessingOverlay({
  planReviewId,
  phase,
  preparedPages = 0,
  expectedPages = 0,
  fileCount = 0,
  projectName,
  fileNames,
  onOpenDashboard,
  onComplete,
}: Props) {
  // Track when the analyzing phase started so we can show a friendly ETA.
  const [analyzeStartedAt, setAnalyzeStartedAt] = useState<number | null>(null);
  useEffect(() => {
    if (phase === "analyzing" && analyzeStartedAt === null) setAnalyzeStartedAt(Date.now());
    if (phase !== "analyzing") setAnalyzeStartedAt(null);
  }, [phase, analyzeStartedAt]);

  // Tick every second so the elapsed counter feels alive.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (phase !== "analyzing") return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  const headline = (() => {
    switch (phase) {
      case "bootstrapping":
        return "Getting your review ready";
      case "uploading":
        return fileCount > 0
          ? `Uploading ${fileCount} PDF${fileCount === 1 ? "" : "s"}`
          : "Uploading PDFs";
      case "preparing":
        return "Preparing pages for analysis";
      case "analyzing":
      default:
        return "Reviewing your plans";
    }
  })();

  const subtitle = (() => {
    switch (phase) {
      case "bootstrapping":
        return "Saving your project and preparing the workspace…";
      case "uploading":
        return "Sending your plans to secure storage. Don't close this tab.";
      case "preparing":
        return "Your browser is rendering each sheet so the AI can read them.";
      case "analyzing":
      default:
        return "Usually 2–4 minutes. Safe to close this tab — we'll keep working.";
    }
  })();

  const showPrepProgress = (phase === "uploading" || phase === "preparing") && expectedPages > 0;
  const prepPct = expectedPages > 0 ? Math.min(100, Math.round((preparedPages / expectedPages) * 100)) : 0;

  // ETA / elapsed for the analyzing window.
  const elapsedMs = analyzeStartedAt ? Date.now() - analyzeStartedAt : 0;
  const remainingMs = Math.max(0, ANALYZE_TARGET_MS - elapsedMs);
  const fmt = (ms: number) => {
    const total = Math.round(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex-1 flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="w-full max-w-md space-y-5 rounded-xl border border-border/60 bg-card/60 backdrop-blur p-4 sm:p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <Loader2 className="h-5 w-5 text-accent animate-spin shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground truncate">{headline}</h2>
              {phase === "analyzing" && analyzeStartedAt && (
                <span className="text-2xs font-mono text-muted-foreground tabular-nums shrink-0">
                  {fmt(elapsedMs)} elapsed · ~{fmt(remainingMs)} left
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>

        {/* Bootstrapping context — reflect the user's input back so they trust the system "got" it. */}
        {phase === "bootstrapping" && (projectName || (fileNames && fileNames.length > 0)) && (
          <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 space-y-1">
            {projectName && (
              <p className="text-xs font-medium text-foreground truncate">{projectName}</p>
            )}
            {fileNames && fileNames.length > 0 && (
              <ul className="space-y-0.5">
                {fileNames.slice(0, 4).map((n, i) => (
                  <li
                    key={i}
                    title={n}
                    className="flex items-center gap-1.5 text-2xs text-muted-foreground"
                  >
                    <FileText className="h-3 w-3 shrink-0 text-accent/70" />
                    <span className="truncate">{n}</span>
                  </li>
                ))}
                {fileNames.length > 4 && (
                  <li className="text-2xs text-muted-foreground">+{fileNames.length - 4} more</li>
                )}
              </ul>
            )}
          </div>
        )}

        {/* Pre-pipeline phases: show a simple checklist + page prep bar so the
            user sees continuous motion before stage rows appear. */}
        {phase !== "analyzing" && (
          <ul className="space-y-1.5 text-sm">
            <PreStageItem
              label="Project created"
              done={phase !== "bootstrapping"}
              active={phase === "bootstrapping"}
            />
            <PreStageItem
              label={
                showPrepProgress
                  ? `Preparing pages — ${preparedPages} / ${expectedPages}`
                  : "Uploading & preparing pages"
              }
              done={false}
              active={phase === "uploading" || phase === "preparing"}
            />
            <PreStageItem label="Starting AI analysis" done={false} active={false} muted />
          </ul>
        )}

        {showPrepProgress && (
          <div className="space-y-1">
            <Progress value={prepPct} className="h-1.5" />
            <p className="text-2xs text-muted-foreground tabular-nums text-right">{prepPct}%</p>
          </div>
        )}

        {/* Phase-specific safety message. The "don't close" warning only
            applies while the browser is doing the rasterization. Once the
            pipeline is running server-side it's safe to leave. */}
        {(phase === "uploading" || phase === "preparing") && (
          <p className="text-2xs text-warning-foreground/80 bg-warning/10 border border-warning/30 rounded-md px-2 py-1.5">
            Keep this tab open — closing now will leave pages unprepared.
          </p>
        )}
        {phase === "analyzing" && (
          <p className="flex items-center gap-1.5 text-2xs text-muted-foreground bg-muted/30 border border-border/60 rounded-md px-2 py-1.5">
            <ShieldCheck className="h-3 w-3 text-accent" />
            Safe to close — analysis runs in the background.
          </p>
        )}

        {/* Once the pipeline has actually started writing rows, show the
            real stepper. The page passes phase="analyzing" as soon as
            pipeline rows exist. */}
        {phase === "analyzing" && (
          <PipelineProgressStepper
            planReviewId={planReviewId}
            compact
            mode="core"
            onComplete={onComplete}
          />
        )}

        {onOpenDashboard && phase === "analyzing" && (
          <div className="pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onOpenDashboard}
              className="h-7 text-2xs text-muted-foreground hover:text-foreground"
            >
              View pipeline dashboard <ExternalLink className="h-3 w-3 ml-1" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function PreStageItem({
  label,
  done,
  active,
  muted,
}: {
  label: string;
  done: boolean;
  active: boolean;
  muted?: boolean;
}) {
  return (
    <li className="flex items-start gap-2.5 rounded-md px-2 py-1.5">
      <span className="mt-0.5 shrink-0">
        {done ? (
          <CheckCircle2 className="h-4 w-4 text-accent" />
        ) : active ? (
          <Loader2 className="h-4 w-4 text-accent animate-spin" />
        ) : (
          <FileText className={`h-4 w-4 ${muted ? "text-muted-foreground/40" : "text-muted-foreground"}`} />
        )}
      </span>
      <span className={`text-sm ${muted && !active && !done ? "text-muted-foreground" : "text-foreground"}`}>
        {label}
      </span>
    </li>
  );
}
