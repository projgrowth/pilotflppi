/**
 * Slim banner shown at the top of the workspace when the pipeline is still
 * running. Replaces the full-canvas overlay's "you're done!" ambiguity with
 * a clear "go check the run dashboard" hand-off — the workspace stays
 * usable for browsing the PDF.
 */
import { Loader2, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

interface Props {
  planReviewId: string;
}

export function StillAnalyzingBanner({ planReviewId }: Props) {
  return (
    <div className="shrink-0 border-b border-accent/30 bg-accent/5 px-4 py-2">
      <div className="flex items-center justify-between gap-3 text-xs">
        <div className="flex min-w-0 items-center gap-2 text-foreground">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
          <span className="truncate">
            Still analyzing your plans — findings will appear here when ready.
          </span>
        </div>
        <Link
          to={`/plan-review/${planReviewId}/dashboard`}
          className="flex shrink-0 items-center gap-1 font-medium text-accent hover:underline"
        >
          View progress
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
