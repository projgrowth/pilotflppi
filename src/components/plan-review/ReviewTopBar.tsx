import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ArrowLeft, Sparkles, Loader2, Check, Wind, Plus, ChevronDown, ExternalLink } from "lucide-react";
import { DeadlineRing } from "@/components/DeadlineRing";
import { ContractorHoverCard } from "@/components/ContractorHoverCard";
import { PipelineProgressStepper } from "@/components/plan-review/PipelineProgressStepper";
import { getCountyLabel } from "@/lib/county-utils";
import { cn } from "@/lib/utils";
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
  onPipelineComplete?: () => void;
  onOpenDashboard?: () => void;
}

export function ReviewTopBar({
  projectName, tradeType, address, county, hvhz, contractor,
  round, reviewId, daysLeft, aiRunning, aiCompleteFlash, hasFindings,
  rounds, onBack, onRunAICheck, onNavigateRound, onNewRound,
  onPipelineComplete, onOpenDashboard,
}: ReviewTopBarProps) {
  const button = (
    <Button
      size="sm"
      onClick={onRunAICheck}
      disabled={aiRunning}
      className={cn(
        "h-8 text-xs shrink-0 transition-all",
        aiCompleteFlash !== null
          ? "bg-success text-success-foreground"
          : !hasFindings && !aiRunning
            ? "border border-primary/60 ring-1 ring-primary/20"
            : "",
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
  );

  return (
    <div className="shrink-0 border-b bg-card px-4 py-2.5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold truncate">{projectName || "Plan Review"}</h1>
            {tradeType && tradeType.toLowerCase() !== "building" && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-caption font-medium capitalize shrink-0">{tradeType}</span>
            )}
            {hvhz && (
              <span className="flex items-center gap-0.5 text-caption font-semibold text-destructive shrink-0" title="High Velocity Hurricane Zone">
                <Wind className="h-3 w-3" /> HVHZ
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate">{address}</span>
            <span className="text-muted-foreground/40">·</span>
            <span className="shrink-0">{getCountyLabel(county)}</span>
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

        <DeadlineRing daysElapsed={30 - daysLeft} totalDays={30} size={30} />

        {aiRunning ? (
          <Popover open>
            <PopoverTrigger asChild>{button}</PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-3" sideOffset={8}>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold">Analyzing plans</span>
                {onOpenDashboard && (
                  <button
                    onClick={onOpenDashboard}
                    className="flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground"
                  >
                    Pipeline dashboard <ExternalLink className="h-3 w-3" />
                  </button>
                )}
              </div>
              <PipelineProgressStepper
                planReviewId={reviewId}
                compact
                onComplete={onPipelineComplete}
              />
            </PopoverContent>
          </Popover>
        ) : (
          button
        )}
      </div>
    </div>
  );
}
