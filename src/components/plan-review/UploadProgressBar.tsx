/**
 * Persistent upload-and-prepare progress strip.
 *
 * Replaces the disappearing toast that previously narrated rasterization.
 * Renders inline at the top of PlanViewerPanel so the user *cannot* miss
 * that pages are still being prepared — closing the tab now drops them on
 * the floor and the pipeline starts on a partial manifest.
 *
 * Pure presentation: the parent owns `uploading`, `prepared`, `expected`,
 * and the optional `phase` label.
 */
import { Loader2, AlertTriangle } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface Props {
  uploading: boolean;
  prepared: number;
  expected: number;
  /** "Uploading PDF…" / "Preparing pages…" / "Finalizing…" */
  phase?: string;
}

export function UploadProgressBar({ uploading, prepared, expected, phase }: Props) {
  if (!uploading) return null;

  const pct = expected > 0 ? Math.min(100, Math.round((prepared / expected) * 100)) : 0;
  const partial = expected > 0 && prepared > 0 && prepared < expected;

  return (
    <div className="shrink-0 border-b border-accent/30 bg-accent/5 px-4 py-2">
      <div className="flex items-center gap-2.5">
        <Loader2 className="h-4 w-4 text-accent shrink-0 animate-spin" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-foreground">
              {phase ?? (expected > 0 ? "Preparing pages…" : "Uploading…")}
            </span>
            <span className="text-2xs font-mono text-muted-foreground tabular-nums">
              {expected > 0 ? `${prepared} / ${expected}` : ""}
            </span>
          </div>
          {expected > 0 && <Progress value={pct} className="h-1 mt-1.5" />}
          <p className="mt-1 text-2xs text-muted-foreground flex items-center gap-1">
            {partial && <AlertTriangle className="h-3 w-3 text-warning" />}
            Keep this tab open — closing it now will leave pages unprepared.
          </p>
        </div>
      </div>
    </div>
  );
}
