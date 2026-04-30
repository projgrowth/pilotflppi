/**
 * ReviewReadyCta — "Analysis complete, N findings ready" success card with a
 * primary "Review on the plan →" button that routes the user to the
 * workspace. Shown on the dashboard after the pipeline reaches `complete`
 * AND at least one finding exists.
 */
import { CheckCircle2, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

interface Props {
  planReviewId: string;
  findingCount: number;
}

export function ReviewReadyCta({ planReviewId, findingCount }: Props) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-success/40 bg-success/5 p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Analysis complete — {findingCount} finding{findingCount === 1 ? "" : "s"} ready
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Open the plan to review each finding pinned to its sheet.
          </p>
        </div>
      </div>
      <Button asChild size="sm" className="shrink-0">
        <Link to={`/plan-review/${planReviewId}`}>
          Review on the plan
          <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
        </Link>
      </Button>
    </div>
  );
}
