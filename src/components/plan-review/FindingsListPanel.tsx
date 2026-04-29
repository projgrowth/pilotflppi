/**
 * Right-side findings list — accordion grouped by discipline, with the
 * BulkTriageFilters chip strip, round-diff banner, and per-finding cards.
 *
 * Pure presentation: parent owns state (filters, statuses, active index,
 * repositioning) and passes it in. Lifted out of PlanReviewDetail so the
 * page shell stops scrolling for 200+ lines just to render this list.
 */
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkles, Upload, FileText, X } from "lucide-react";
import { FindingCard, type Finding } from "@/components/FindingCard";
import { BulkTriageFilters, type ConfidenceFilter, type QualityFilter } from "@/components/BulkTriageFilters";
import { ConfidenceMeter } from "@/components/shared/ConfidenceMeter";
import type { FindingStatus } from "@/components/FindingStatusFilter";
import {
  getDisciplineIcon,
  getDisciplineColor,
  getDisciplineLabel,
  DISCIPLINE_ORDER,
} from "@/lib/county-utils";
import { cn } from "@/lib/utils";
import type { FindingHistoryEntry } from "@/hooks/useFindingHistory";

function getWorstSeverity(findings: Finding[]): string {
  if (findings.some((f) => f.severity === "critical")) return "critical";
  if (findings.some((f) => f.severity === "major")) return "major";
  return "minor";
}

/**
 * Map the AI's confidence label to a numeric score for the overall meter.
 * Findings store a string label ("high"/"medium"/"low"/"verified"/"likely"),
 * not a probability. These anchors keep the meter aligned with the spec's
 * thresholds (>85 high / 60–85 medium / <60 low).
 */
const CONFIDENCE_TO_SCORE: Record<string, number> = {
  verified: 0.97,
  high: 0.92,
  likely: 0.78,
  medium: 0.72,
  low: 0.45,
};

function averageConfidence(findings: Finding[]): number {
  if (findings.length === 0) return 0;
  const sum = findings.reduce((acc, f) => {
    const key = (f.confidence || "low").toLowerCase();
    return acc + (CONFIDENCE_TO_SCORE[key] ?? 0.45);
  }, 0);
  return sum / findings.length;
}

interface Props {
  findings: Finding[];
  filteredFindings: Finding[];
  filteredGrouped: Record<string, Finding[]>;
  globalIndexMap: Map<Finding, number>;
  /** Keyed by finding UUID (deficiencies_v2.id), not array index. */
  findingStatuses: Record<string, FindingStatus>;
  activeFindingIndex: number | null;
  onLocate: (globalIndex: number) => void;
  onReposition: (globalIndex: number) => void;
  onStatusChange: (findingId: string, status: FindingStatus) => void;
  findingRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  findingHistory: FindingHistoryEntry[] | undefined;

  // Filter chip state
  statusFilter: FindingStatus | "all";
  onStatusFilterChange: (s: FindingStatus | "all") => void;
  confidenceFilter: ConfidenceFilter;
  onConfidenceFilterChange: (c: ConfidenceFilter) => void;
  disciplineFilter: string | "all";
  onDisciplineFilterChange: (d: string | "all") => void;
  sheetFilter: string | "all";
  onSheetFilterChange: (s: string | "all") => void;
  qualityFilter?: QualityFilter;
  onQualityFilterChange?: (q: QualityFilter) => void;

  // Roll-ups
  openCount: number;
  resolvedCount: number;
  deferredCount: number;
  confidenceCounts: Record<ConfidenceFilter, number>;
  qualityCounts?: Record<QualityFilter, number>;
  disciplinesPresent: string[];
  sheetsPresent: string[];
  allVisibleResolved: boolean;
  onMarkVisibleResolved: () => void;

  // Round diff
  hasRoundDiff: boolean;
  round: number;
  newCount: number;
  persistedCount: number;
  newlyResolvedCount: number;
  diffMap: Map<number, "new" | "carried">;

  // Empty-state CTAs
  hasDocuments: boolean;
  fileUrls: string[];
  onOpenDashboard: () => void;
  /** True while the AI pipeline is still running. When true we show a
   *  locked "Analyzing…" state instead of the partial findings list so
   *  reviewers don't mistake an in-flight result set for the final output. */
  pipelineProcessing?: boolean;
  /** When set (count of findings just produced), shows a celebratory
   *  completion banner above the list with a one-click "Generate letter"
   *  CTA. Parent clears it after ~3s. */
  completionFlash?: number | null;
  onDismissCompletionFlash?: () => void;
  onGenerateLetterClick?: () => void;
}

export function FindingsListPanel(props: Props) {
  const hasFindings = props.findings.length > 0;

  // While the pipeline is still working, hide the partial list entirely.
  // Streaming findings as they arrive made early discipline runs look like
  // the final answer ("only one thing to review"). Lock the panel until
  // analysis completes — the left canvas already shows live progress.
  if (props.pipelineProcessing) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <div className="text-center space-y-3 max-w-[260px]">
          <div className="mx-auto w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-accent animate-pulse" />
          </div>
          <p className="text-sm font-medium">Analyzing your plans</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Findings will appear here once the first pass finishes. Live
            progress is on the left.
            {hasFindings && (
              <>
                <br />
                <span className="text-2xs text-muted-foreground/80">
                  {props.findings.length} so far · still verifying
                </span>
              </>
            )}
          </p>
        </div>
      </div>
    );
  }

  if (!hasFindings) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        {props.hasDocuments ? (
          <div className="text-center space-y-3 max-w-[220px]">
            <div className="mx-auto w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-accent" />
            </div>
            <p className="text-sm font-medium">Ready to analyze</p>
            <p className="text-xs text-muted-foreground">
              {props.fileUrls.length} document{props.fileUrls.length > 1 ? "s" : ""} loaded
            </p>
            <Button size="sm" onClick={props.onOpenDashboard} className="w-full">
              <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Open Dashboard
            </Button>
          </div>
        ) : (
          <div className="text-center space-y-2">
            <Upload className="h-8 w-8 text-muted-foreground/20 mx-auto" />
            <p className="text-sm text-muted-foreground">Upload documents to begin</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <ConfidenceMeter
        score={averageConfidence(props.findings)}
        sampleLabel={`across ${props.findings.length} finding${props.findings.length === 1 ? "" : "s"}`}
      />
      <BulkTriageFilters
        statusCounts={{
          all: props.findings.length,
          open: props.openCount,
          resolved: props.resolvedCount,
          deferred: props.deferredCount,
        }}
        statusFilter={props.statusFilter}
        onStatusFilterChange={props.onStatusFilterChange}
        confidenceCounts={props.confidenceCounts}
        confidenceFilter={props.confidenceFilter}
        onConfidenceFilterChange={props.onConfidenceFilterChange}
        disciplines={props.disciplinesPresent}
        disciplineFilter={props.disciplineFilter}
        onDisciplineFilterChange={props.onDisciplineFilterChange}
        sheets={props.sheetsPresent}
        sheetFilter={props.sheetFilter}
        onSheetFilterChange={props.onSheetFilterChange}
        visibleCount={props.filteredFindings.length}
        allVisibleResolved={props.allVisibleResolved}
        onMarkVisibleResolved={props.onMarkVisibleResolved}
        qualityCounts={props.qualityCounts}
        qualityFilter={props.qualityFilter}
        onQualityFilterChange={props.onQualityFilterChange}
      />
      {props.hasRoundDiff && (
        <div className="rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1.5 flex items-center gap-3 text-2xs">
          <span className="font-semibold text-accent uppercase tracking-wide">
            Round {props.round} vs R{props.round - 1}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-accent" /> <strong>{props.newCount}</strong> new
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />{" "}
            <strong>{props.persistedCount}</strong> persisted
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-success" /> <strong>{props.newlyResolvedCount}</strong>{" "}
            resolved since R{props.round - 1}
          </span>
        </div>
      )}
      <Accordion
        type="multiple"
        defaultValue={[
          ...DISCIPLINE_ORDER.filter((d) => props.filteredGrouped[d]),
          ...Object.keys(props.filteredGrouped).filter((d) => !DISCIPLINE_ORDER.includes(d as never)),
        ]}
        className="space-y-1"
      >
        {[
          ...DISCIPLINE_ORDER.filter((d) => props.filteredGrouped[d]),
          // Append any disciplines the AI emitted that aren't in our canonical
          // order so findings are NEVER silently dropped from the list.
          ...Object.keys(props.filteredGrouped).filter((d) => !DISCIPLINE_ORDER.includes(d as never)),
        ].map((discipline) => {
          const group = props.filteredGrouped[discipline];
          const Icon = getDisciplineIcon(discipline);
          const worst = getWorstSeverity(group);
          return (
            <AccordionItem key={discipline} value={discipline} className="border rounded-lg overflow-hidden">
              <AccordionTrigger className="px-3 py-2 hover:no-underline hover:bg-muted/30 text-xs">
                <div className="flex items-center gap-2">
                  <Icon className={cn("h-3.5 w-3.5", getDisciplineColor(discipline))} />
                  <span className="font-medium">{getDisciplineLabel(discipline)}</span>
                  <Badge variant="secondary" className="text-[9px] h-4 px-1">
                    {group.length}
                  </Badge>
                  <div
                    className={cn("h-1.5 w-1.5 rounded-full", {
                      "bg-destructive": worst === "critical",
                      "bg-warning": worst === "major",
                      "bg-muted-foreground/40": worst === "minor",
                    })}
                  />
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3 space-y-1.5">
                {group.map((finding, i) => {
                  const gi = props.globalIndexMap.get(finding)!;
                  const fid = finding.finding_id;
                  const diffStatus = props.diffMap.get(gi);
                  return (
                    <div key={fid ?? i} className="relative">
                      {props.hasRoundDiff && diffStatus && (
                        <div
                          className={cn(
                            "absolute -left-2 top-1/2 -translate-y-1/2 w-1 h-1 rounded-full z-10",
                            diffStatus === "new" ? "bg-accent" : "bg-muted-foreground/40",
                          )}
                        />
                      )}
                      <FindingCard
                        ref={(el) => {
                          if (el) props.findingRefs.current.set(gi, el);
                        }}
                        finding={finding}
                        index={i}
                        globalIndex={gi}
                        isActive={props.activeFindingIndex === gi}
                        onLocateClick={() => props.onLocate(gi)}
                        onRepositionClick={() => props.onReposition(gi)}
                        animationDelay={i * 40}
                        status={(fid && props.findingStatuses[fid]) || "open"}
                        onStatusChange={(status) => fid && props.onStatusChange(fid, status)}
                        history={(props.findingHistory || []).filter(
                          (h) => fid && (h.note || "").includes(`finding_id=${fid}`),
                        )}
                      />
                    </div>
                  );
                })}
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </>
  );
}
