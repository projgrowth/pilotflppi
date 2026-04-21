import { useMemo } from "react";
import { Layers, ArrowRight, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  usePipelineStatus,
  useDeficienciesV2,
  type DeficiencyV2Row,
} from "@/hooks/useReviewDashboard";
import { scrollToFinding } from "@/lib/finding-jump";
import { requestShowSuperseded } from "./DeficiencyList";

interface MergeEntry {
  winner: string;
  winner_def_number?: string | null;
  winner_discipline?: string | null;
  winner_confidence?: number | null;
  loser_ids?: string[];
  loser_count?: number;
  reason: string;
}

interface DedupeMetadata {
  examined?: number;
  groups_merged?: number;
  findings_superseded?: number;
  merges?: MergeEntry[];
}

interface Props {
  planReviewId: string;
  /** Called when the user clicks "Jump to" — parent should switch to Deficiencies tab. */
  onJump: (findingId: string) => void;
}

export default function DedupeAuditTrail({ planReviewId, onJump }: Props) {
  const { data: pipeRows = [] } = usePipelineStatus(planReviewId);
  const { data: defs = [] } = useDeficienciesV2(planReviewId);

  const meta = useMemo<DedupeMetadata>(() => {
    const row = pipeRows.find((r) => r.stage === "dedupe");
    return ((row as unknown as { metadata?: DedupeMetadata } | undefined)?.metadata ??
      {}) as DedupeMetadata;
  }, [pipeRows]);

  const defById = useMemo(() => {
    const m = new Map<string, DeficiencyV2Row>();
    for (const d of defs) m.set(d.id, d);
    return m;
  }, [defs]);

  const merges = meta.merges ?? [];

  const handleJump = (id: string, isLoser: boolean) => {
    if (isLoser) requestShowSuperseded();
    onJump(id);
    // Small delay so the tab content mounts before we look for the element.
    scrollToFinding(id, { delayMs: 160 });
  };

  if (merges.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center">
        <Layers className="mx-auto h-8 w-8 text-muted-foreground/60" />
        <h3 className="mt-3 text-sm font-semibold">No dedupe merges yet</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          The dedupe stage hasn't run, or no cross-discipline duplicates were detected.
          Run the pipeline to populate this view.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center gap-2 text-sm">
          <Layers className="h-4 w-4 text-primary" />
          <span className="font-semibold">Cross-discipline dedupe audit trail</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {meta.examined ?? 0} findings examined · {meta.groups_merged ?? 0} merge group
          {meta.groups_merged === 1 ? "" : "s"} · {meta.findings_superseded ?? 0} marked superseded.
          Use the jump links to inspect each merge. If a merge looks wrong, open the loser and flip
          its status back to <code className="rounded bg-muted px-1 font-mono">open</code>.
        </p>
      </div>

      <ol className="space-y-3">
        {merges.map((m, i) => {
          const winner = defById.get(m.winner);
          const loserIds = m.loser_ids ?? [];
          const conf = m.winner_confidence ?? winner?.confidence_score ?? null;

          return (
            <li
              key={`${m.winner}-${i}`}
              className="rounded-lg border bg-card p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="outline" className="font-mono">
                      Merge #{i + 1}
                    </Badge>
                    {conf != null && (
                      <span className="font-mono text-2xs text-muted-foreground">
                        winner conf {(conf * 100).toFixed(0)}%
                      </span>
                    )}
                    <span className="text-2xs text-muted-foreground">
                      {loserIds.length || m.loser_count || 0} superseded
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm leading-snug">{m.reason}</p>
                </div>
              </div>

              {/* Winner */}
              <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-2xs uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                      Kept (winner)
                    </div>
                    <div className="mt-0.5 truncate text-sm font-medium">
                      {winner ? (
                        <>
                          <span className="font-mono">{winner.def_number}</span>{" "}
                          <span className="text-muted-foreground">·</span>{" "}
                          <span className="capitalize">
                            {winner.discipline.replace(/_/g, " ")}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground italic">
                          {m.winner_def_number ?? "Winner not found"}
                        </span>
                      )}
                    </div>
                    {winner && (
                      <div className="mt-1 truncate text-xs text-muted-foreground">
                        {winner.finding}
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleJump(m.winner, false)}
                    disabled={!winner}
                  >
                    Jump to <ArrowRight className="ml-1 h-3 w-3" />
                  </Button>
                </div>
              </div>

              {/* Losers */}
              <div className="mt-2 space-y-1.5">
                {loserIds.length === 0 ? (
                  <div className="rounded-md border border-dashed bg-muted/30 p-2 text-2xs text-muted-foreground">
                    Loser IDs not recorded for this merge — re-run the pipeline to backfill.
                  </div>
                ) : (
                  loserIds.map((lid) => {
                    const loser = defById.get(lid);
                    return (
                      <div
                        key={lid}
                        className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 p-2"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-2xs uppercase tracking-wide text-muted-foreground">
                            Superseded
                          </div>
                          <div className="mt-0.5 truncate text-xs">
                            {loser ? (
                              <>
                                <span className="font-mono">{loser.def_number}</span>{" "}
                                <span className="text-muted-foreground">·</span>{" "}
                                <span className="capitalize text-muted-foreground">
                                  {loser.discipline.replace(/_/g, " ")}
                                </span>
                                <span className="text-muted-foreground"> — </span>
                                <span className="text-muted-foreground">{loser.finding}</span>
                              </>
                            ) : (
                              <span className="flex items-center gap-1 text-muted-foreground italic">
                                <AlertCircle className="h-3 w-3" />
                                Finding {lid.slice(0, 8)} not loaded
                              </span>
                            )}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleJump(lid, true)}
                          disabled={!loser}
                          className="shrink-0"
                        >
                          Jump <ArrowRight className="ml-1 h-3 w-3" />
                        </Button>
                      </div>
                    );
                  })
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
