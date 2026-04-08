import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, GitCompareArrows } from "lucide-react";

interface Round {
  id: string;
  round: number;
  created_at: string;
  ai_check_status: string;
  findingsCount: number;
}

interface RoundNavigatorProps {
  rounds: Round[];
  currentRoundId: string;
  onRoundSelect: (roundId: string) => void;
  onNewRound: () => void;
  showDiff: boolean;
  onToggleDiff: () => void;
  className?: string;
}

export function RoundNavigator({
  rounds,
  currentRoundId,
  onRoundSelect,
  onNewRound,
  showDiff,
  onToggleDiff,
  className,
}: RoundNavigatorProps) {
  const currentIndex = rounds.findIndex((r) => r.id === currentRoundId);
  const hasPrevRound = rounds.length > 1;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {/* Round chips */}
      <div className="flex items-center gap-1">
        {rounds.map((round, i) => {
          const isActive = round.id === currentRoundId;
          return (
            <button
              key={round.id}
              onClick={() => onRoundSelect(round.id)}
              className={cn(
                "flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all",
                isActive
                  ? "bg-accent text-accent-foreground shadow-sm"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted"
              )}
            >
              R{round.round}
              {round.findingsCount > 0 && (
                <span className={cn(
                  "rounded-full px-1 text-[9px]",
                  isActive ? "bg-accent-foreground/20" : "bg-muted-foreground/20"
                )}>
                  {round.findingsCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Diff toggle */}
      {hasPrevRound && (
        <Button
          size="sm"
          variant={showDiff ? "default" : "outline"}
          className={cn("h-6 text-[10px] gap-1", showDiff && "bg-accent text-accent-foreground")}
          onClick={onToggleDiff}
        >
          <GitCompareArrows className="h-3 w-3" />
          Diff
        </Button>
      )}

      {/* New round button */}
      <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={onNewRound}>
        + New Round
      </Button>
    </div>
  );
}
