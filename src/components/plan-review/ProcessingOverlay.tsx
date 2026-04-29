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
import { Loader2, ExternalLink, FileText, CheckCircle2 } from "lucide-react";
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
  onOpenDashboard?: () => void;
  /** Fired exactly once when the terminal stage lands. */
  onComplete?: () => void;
}

export function ProcessingOverlay({
  planReviewId,
  phase,
  preparedPages = 0,
  expectedPages = 0,
  fileCount = 0,
  onOpenDashboard,
  onComplete,
}: Props) {
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
        return "Usually 2–4 minutes. You can leave this page — we'll notify you when it's done.";
    }
  })();

  const showPrepProgress = (phase === "uploading" || phase === "preparing") && expectedPages > 0;
  const prepPct = expectedPages > 0 ? Math.min(100, Math.round((preparedPages / expectedPages) * 100)) : 0;

  return (
    <div className="flex-1 flex items-center justify-center p-6 overflow-y-auto">
      <div className="w-full max-w-md space-y-5 rounded-xl border border-border/60 bg-card/60 backdrop-blur p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 text-accent animate-spin shrink-0" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">{headline}</h2>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>

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
