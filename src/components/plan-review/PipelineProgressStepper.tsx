import { Loader2, Check, AlertCircle, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePipelineStatus, PIPELINE_STAGES, type PipelineStage } from "@/hooks/useReviewDashboard";

interface PipelineProgressStepperProps {
  planReviewId: string;
  className?: string;
  /** Optional callback fired exactly once when the `complete` stage flips to status 'complete'. */
  onComplete?: () => void;
  /** Hide stages that aren't part of the typical user-facing flow (kept verbose by default). */
  compact?: boolean;
}

// Stages we surface in the friendly stepper. Keeps "complete" as the terminator.
const VISIBLE_STAGES: PipelineStage[] = [
  "upload",
  "prepare_pages",
  "sheet_map",
  "dna_extract",
  "discipline_review",
  "verify",
  "ground_citations",
  "dedupe",
  "prioritize",
  "complete",
];

const FRIENDLY_LABELS: Record<PipelineStage, string> = {
  upload: "Upload",
  prepare_pages: "Prepare pages",
  sheet_map: "Sheet map",
  dna_extract: "Project DNA",
  discipline_review: "Discipline review",
  cross_check: "Cross-check",
  verify: "Verify",
  ground_citations: "Ground citations",
  dedupe: "Dedupe",
  deferred_scope: "Deferred scope",
  prioritize: "Prioritize",
  complete: "Comment letter",
};

const FRIENDLY_HINTS: Partial<Record<PipelineStage, string>> = {
  upload: "Files received",
  prepare_pages: "Rasterizing PDF pages in chunks",
  sheet_map: "Indexing sheets",
  dna_extract: "Reading title block & code data",
  discipline_review: "Architectural, structural, MEP, life safety…",
  verify: "Cross-checking findings against evidence",
  ground_citations: "Matching FBC sections",
  dedupe: "Merging overlapping findings",
  prioritize: "Ranking by severity",
  complete: "Drafting comment letter",
};

export function PipelineProgressStepper({
  planReviewId,
  className,
  onComplete,
  compact = false,
}: PipelineProgressStepperProps) {
  const { data: rows = [] } = usePipelineStatus(planReviewId);

  const byStage = new Map<PipelineStage, (typeof rows)[number]>();
  for (const r of rows) byStage.set(r.stage as PipelineStage, r);

  // Fire onComplete once when the terminal stage lands.
  const completeRow = byStage.get("complete");
  if (completeRow?.status === "complete" && onComplete) {
    // Defer to next tick so React doesn't warn about state updates during render.
    queueMicrotask(onComplete);
  }

  const stages = compact ? PIPELINE_STAGES.filter((s) => VISIBLE_STAGES.includes(s.key)) : PIPELINE_STAGES;

  return (
    <ul className={cn("space-y-1.5", className)}>
      {stages
        .filter((s) => VISIBLE_STAGES.includes(s.key))
        .map((s) => {
          const row = byStage.get(s.key);
          const status = row?.status ?? "pending";
          const label = FRIENDLY_LABELS[s.key];
          const hint = FRIENDLY_HINTS[s.key];

          return (
            <li
              key={s.key}
              className={cn(
                "flex items-start gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                status === "running" && "bg-accent/10",
                status === "error" && "bg-destructive/10",
              )}
            >
              <span className="mt-0.5 shrink-0">
                {status === "complete" ? (
                  <Check className="h-4 w-4 text-accent" />
                ) : status === "running" ? (
                  <Loader2 className="h-4 w-4 text-accent animate-spin" />
                ) : status === "error" ? (
                  <AlertCircle className="h-4 w-4 text-destructive" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground/40" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "font-medium",
                    status === "pending" && "text-muted-foreground",
                    status === "error" && "text-destructive",
                  )}
                >
                  {label}
                </span>
                {status === "error" && row?.error_message ? (
                  <span className="ml-2 text-xs text-destructive/80">{row.error_message}</span>
                ) : status === "running" && hint ? (
                  <span className="ml-2 text-xs text-muted-foreground">{hint}…</span>
                ) : status === "complete" && hint ? (
                  <span className="ml-2 text-xs text-muted-foreground">{hint}</span>
                ) : null}
              </span>
            </li>
          );
        })}
    </ul>
  );
}
