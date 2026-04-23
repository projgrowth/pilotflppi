/**
 * Round-2+ carryover panel. Lists findings copied forward from the prior
 * round because the AI detected the underlying sheets didn't change. The
 * pipeline marks these with `metadata.carryover_from_round = N-1` so this
 * panel can find them without a separate query — it just filters the same
 * findings array the rest of the page uses.
 *
 * Renders only when there's at least one carryover finding. Click a row →
 * scroll the corresponding card into view (uses the same `findingRefs` map
 * that powers J/K nav).
 */
import { ChevronRight, History } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Finding } from "@/components/FindingCard";

interface Props {
  findings: Finding[];
  currentRound: number;
  onJumpTo?: (index: number) => void;
}

interface FindingWithMeta extends Finding {
  metadata?: { carryover_from_round?: number } | null;
}

export function RoundCarryoverPanel({ findings, currentRound, onJumpTo }: Props) {
  if (currentRound < 2) return null;

  const carryovers: Array<{ f: FindingWithMeta; index: number }> = [];
  for (let i = 0; i < findings.length; i++) {
    const f = findings[i] as FindingWithMeta;
    if (f.metadata && typeof f.metadata.carryover_from_round === "number") {
      carryovers.push({ f, index: i });
    }
  }

  if (carryovers.length === 0) return null;

  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
      <Collapsible defaultOpen={false}>
        <CollapsibleTrigger className="flex w-full items-center gap-2 text-left">
          <History className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400" />
          <span className="font-medium text-amber-700 dark:text-amber-300">
            {carryovers.length} carried over from prior round{carryovers.length === 1 ? "" : "s"}
          </span>
          <ChevronRight className="ml-auto h-3 w-3 opacity-50 transition-transform data-[state=open]:rotate-90" />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-1.5">
          <p className="text-2xs text-muted-foreground">
            These sheets didn't change between rounds, so the AI replayed the
            prior round's findings instead of re-reviewing. Mark resolved if
            the contractor addressed them outside the plan set.
          </p>
          <ul className="space-y-1">
            {carryovers.slice(0, 12).map(({ f, index }) => (
              <li key={f.finding_id ?? index}>
                <button
                  type="button"
                  onClick={() => onJumpTo?.(index)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded border border-border/40 bg-background/60 px-2 py-1.5 text-left",
                    "hover:border-amber-500/40 hover:bg-amber-500/10",
                  )}
                >
                  <Badge variant="outline" className="mt-0.5 px-1 py-0 text-2xs font-mono">
                    R{f.metadata?.carryover_from_round ?? "?"}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs">{f.finding ?? "Untitled finding"}</div>
                    {f.code_ref && (
                      <div className="mt-0.5 truncate font-mono text-2xs text-muted-foreground">
                        {f.code_ref}
                        {f.page ? ` · ${f.page}` : ""}
                      </div>
                    )}
                  </div>
                </button>
              </li>
            ))}
            {carryovers.length > 12 && (
              <li className="text-center text-2xs text-muted-foreground">
                +{carryovers.length - 12} more carryovers
              </li>
            )}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
