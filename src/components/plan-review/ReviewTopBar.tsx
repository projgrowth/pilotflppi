import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ArrowLeft, Sparkles, Loader2, Check, Wind, Plus, ChevronDown } from "lucide-react";
import { DeadlineRing } from "@/components/DeadlineRing";
import { ContractorHoverCard } from "@/components/ContractorHoverCard";
import { getCountyLabel } from "@/lib/county-utils";
import { cn } from "@/lib/utils";
import type { Finding } from "@/components/FindingCard";
import type { ContractorInfo } from "@/types";

interface ReviewTopBarProps {
  projectName: string;
  tradeType: string;
  address: string;
  county: string;
  hvhz: boolean;
  contractor: ContractorInfo | null;
  round: number;
  reviewId: string;
  daysLeft: number;
  aiRunning: boolean;
  aiCompleteFlash: number | null;
  hasFindings: boolean;
  rounds: Array<{ id: string; round: number; findingsCount: number }>;
  onBack: () => void;
  onRunAICheck: () => void;
  onNavigateRound: (id: string) => void;
  onNewRound: () => void;
}

export function ReviewTopBar({
  projectName, tradeType, address, county, hvhz, contractor,
  round, reviewId, daysLeft, aiRunning, aiCompleteFlash, hasFindings,
  rounds, onBack, onRunAICheck, onNavigateRound, onNewRound,
}: ReviewTopBarProps) {
  return (
    <div className="shrink-0 border-b bg-card px-4 py-2.5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold truncate">{projectName || "Plan Review"}</h1>
            <span className="rounded bg-muted px-1.5 py-0.5 text-caption font-medium capitalize shrink-0">{tradeType}</span>
            {hvhz && (
              <span className="flex items-center gap-0.5 text-caption font-semibold text-destructive shrink-0">
                <Wind className="h-3 w-3" /> HVHZ
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="truncate">{address}</span>
            <span>{getCountyLabel(county)} County</span>
            {contractor && <ContractorHoverCard contractor={contractor} />}
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-semibold bg-accent text-accent-foreground shrink-0">
              R{round}
              <ChevronDown className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[120px]">
            {rounds.map((r) => (
              <DropdownMenuItem
                key={r.id}
                onClick={() => onNavigateRound(r.id)}
                className={cn("text-xs", r.id === reviewId && "bg-accent/10 font-medium")}
              >
                R{r.round}
                {r.findingsCount > 0 && (
                  <span className="ml-auto text-caption text-muted-foreground">{r.findingsCount} findings</span>
                )}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onClick={onNewRound} className="text-xs text-accent">
              <Plus className="h-3 w-3 mr-1" /> New Round
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DeadlineRing daysElapsed={21 - daysLeft} totalDays={21} size={30} />

        <Button
          size="sm"
          onClick={onRunAICheck}
          disabled={aiRunning}
          className={cn(
            "h-8 text-xs shrink-0 transition-all",
            aiCompleteFlash !== null
              ? "bg-success text-success-foreground"
              : !hasFindings && !aiRunning
              ? "bg-accent text-accent-foreground hover:bg-accent/90 animate-pulse"
              : "bg-accent text-accent-foreground hover:bg-accent/90"
          )}
        >
          {aiCompleteFlash !== null ? (
            <><Check className="h-3.5 w-3.5 mr-1.5" /> ✓ {aiCompleteFlash} findings</>
          ) : aiRunning ? (
            <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Analyzing...</>
          ) : (
            <><Sparkles className="h-3.5 w-3.5 mr-1.5" /> {hasFindings ? "Re-Analyze" : "Run AI Check"}</>
          )}
        </Button>
      </div>
    </div>
  );
}