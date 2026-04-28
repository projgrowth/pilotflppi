/**
 * ReviewCostChip
 *
 * Compact "this review cost $X and ran for Ys of AI time" pill for the
 * workspace header. Pilots ask about unit economics constantly — surfacing
 * per-review spend kills that question with one glance. Hidden until the
 * pipeline has logged at least one cost_metric so it doesn't render an
 * empty placeholder during early stages.
 */

import { DollarSign, ChevronDown, Timer } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  useReviewCostSummary,
  formatCostUsd,
  formatDurationMs,
} from "@/hooks/useReviewCostSummary";

interface Props {
  planReviewId: string;
}

export default function ReviewCostChip({ planReviewId }: Props) {
  const { data: summary } = useReviewCostSummary(planReviewId);
  if (!summary || summary.calls === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
            "border-border bg-muted/40 text-muted-foreground hover:bg-muted/70",
          )}
          title="AI spend & latency for this review"
        >
          <DollarSign className="h-3 w-3" />
          <span className="font-medium">Cost</span>
          <span className="font-mono text-foreground">
            {formatCostUsd(summary.estimatedUsd)}
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="font-mono text-foreground">
            {formatDurationMs(summary.totalMs)}
          </span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[320px] p-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between border-b pb-1.5">
            <div className="text-xs font-semibold">AI spend (this review)</div>
            <div className="font-mono text-2xs text-muted-foreground">
              {summary.calls} call{summary.calls === 1 ? "" : "s"}
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-2xs">
            <dt className="text-muted-foreground">Estimated cost</dt>
            <dd className="text-right font-mono font-medium">
              {formatCostUsd(summary.estimatedUsd)}
            </dd>
            <dt className="text-muted-foreground">AI compute time</dt>
            <dd className="text-right font-mono font-medium">
              <Timer className="mr-0.5 inline h-3 w-3 text-muted-foreground" />
              {formatDurationMs(summary.totalMs)}
            </dd>
            <dt className="text-muted-foreground">Input tokens</dt>
            <dd className="text-right font-mono">
              {summary.inputTokens.toLocaleString()}
            </dd>
            <dt className="text-muted-foreground">Output tokens</dt>
            <dd className="text-right font-mono">
              {summary.outputTokens.toLocaleString()}
            </dd>
          </dl>
          <p className="border-t pt-1.5 text-2xs leading-relaxed text-muted-foreground">
            Estimate uses blended pricing ($1.25/M input · $5/M output). Actual
            workspace billing is on the firm's Lovable AI usage page.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
