/**
 * Per-stage cost & timing rollup for the Pipeline Activity page.
 *
 * Reads cost_metric rows emitted by callAI in run-review-pipeline. Pure
 * presentation — the hook owns query state.
 */
import { useState } from "react";
import { ChevronDown, ChevronUp, DollarSign, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { usePipelineCostMetrics } from "@/hooks/usePipelineCostMetrics";
import { shortStageLabel } from "@/lib/pipeline-stages";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export function CostTimingPanel() {
  const [open, setOpen] = useState(false);
  const { data: rows = [], isLoading } = usePipelineCostMetrics(7);

  const totalIn = rows.reduce((a, r) => a + r.totalInputTokens, 0);
  const totalOut = rows.reduce((a, r) => a + r.totalOutputTokens, 0);
  const totalCalls = rows.reduce((a, r) => a + r.calls, 0);

  return (
    <Card>
      <CardContent className="p-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <div className="flex items-center gap-2 min-w-0">
            <DollarSign className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-semibold text-foreground">
              Cost &amp; timing (last 7d)
            </span>
            {!isLoading && totalCalls > 0 && (
              <span className="text-xs text-muted-foreground font-mono">
                · {totalCalls} calls · {formatTokens(totalIn)} in · {formatTokens(totalOut)} out
              </span>
            )}
            {isLoading && (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            )}
          </div>
          {open ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
        </button>

        {open && (
          <div className="mt-3 border-t pt-3">
            {rows.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No cost telemetry yet. Run a review and per-stage token usage will appear here.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground border-b">
                      <th className="text-left font-mono uppercase tracking-wide font-semibold py-1.5">Stage</th>
                      <th className="text-right font-mono uppercase tracking-wide font-semibold">Calls</th>
                      <th className="text-right font-mono uppercase tracking-wide font-semibold">Avg time</th>
                      <th className="text-right font-mono uppercase tracking-wide font-semibold">Input tok</th>
                      <th className="text-right font-mono uppercase tracking-wide font-semibold">Output tok</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.stage} className="border-b last:border-b-0">
                        <td className="py-1.5 font-mono text-foreground">
                          {shortStageLabel(r.stage)}
                        </td>
                        <td className="text-right font-mono text-foreground tabular-nums">
                          {r.calls}
                        </td>
                        <td className="text-right font-mono text-muted-foreground tabular-nums">
                          {formatMs(r.avgMs)}
                        </td>
                        <td className="text-right font-mono text-muted-foreground tabular-nums">
                          {formatTokens(r.totalInputTokens)}
                        </td>
                        <td className="text-right font-mono text-muted-foreground tabular-nums">
                          {formatTokens(r.totalOutputTokens)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 h-6 text-2xs text-muted-foreground"
              onClick={() => setOpen(false)}
            >
              Collapse
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
