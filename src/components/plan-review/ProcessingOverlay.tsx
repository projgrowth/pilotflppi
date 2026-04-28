/**
 * Full-canvas "we're working on your plans" surface that lives inside the
 * left viewer panel while the pipeline runs.
 *
 * Replaces the previous behavior where the canvas sat on a tiny "Loading
 * document…" spinner with no indication of what was actually happening.
 *
 * Reuses PipelineProgressStepper for all the realtime / heartbeat / stuck-
 * detection / auto-retry plumbing — this component only adds the headline
 * shell and a calm "you can leave this page" footnote.
 */
import { Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PipelineProgressStepper } from "@/components/plan-review/PipelineProgressStepper";

interface Props {
  planReviewId: string;
  /** Optional: open the pipeline dashboard in a new view. */
  onOpenDashboard?: () => void;
  /** Fired exactly once when the terminal stage lands. */
  onComplete?: () => void;
}

export function ProcessingOverlay({ planReviewId, onOpenDashboard, onComplete }: Props) {
  return (
    <div className="flex-1 flex items-center justify-center p-6 overflow-y-auto">
      <div className="w-full max-w-md space-y-5 rounded-xl border border-border/60 bg-card/60 backdrop-blur p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 text-accent animate-spin shrink-0" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">Reviewing your plans</h2>
            <p className="text-xs text-muted-foreground">
              Usually 2–4 minutes. You can leave this page — we'll notify you when it's done.
            </p>
          </div>
        </div>

        <PipelineProgressStepper
          planReviewId={planReviewId}
          compact
          mode="core"
          onComplete={onComplete}
        />

        {onOpenDashboard && (
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
