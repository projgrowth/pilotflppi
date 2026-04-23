import { useEffect, useMemo, useState } from "react";
import { Loader2, Check, AlertCircle, Circle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
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

// A stage is considered "stuck" if it's been in the `running` state without
// any heartbeat for this long. Edge workers normally complete a stage chunk
// in ≤ 30s; 90s gives plenty of headroom for cold starts before we offer
// the user a retry nudge.
const STUCK_THRESHOLD_MS = 90_000;

export function PipelineProgressStepper({
  planReviewId,
  className,
  onComplete,
  compact = false,
}: PipelineProgressStepperProps) {
  const { data: rows = [] } = usePipelineStatus(planReviewId);
  const [retryingStage, setRetryingStage] = useState<PipelineStage | null>(null);
  // Tick every 15s so the "stuck" detector re-evaluates without waiting for
  // a realtime row update (a stuck row by definition isn't getting updates).
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  const byStage = useMemo(() => {
    const m = new Map<PipelineStage, (typeof rows)[number]>();
    for (const r of rows) m.set(r.stage as PipelineStage, r);
    return m;
  }, [rows]);

  // Fire onComplete once when the terminal stage lands.
  const completeRow = byStage.get("complete");
  if (completeRow?.status === "complete" && onComplete) {
    // Defer to next tick so React doesn't warn about state updates during render.
    queueMicrotask(onComplete);
  }

  const stages = compact ? PIPELINE_STAGES.filter((s) => VISIBLE_STAGES.includes(s.key)) : PIPELINE_STAGES;

  const handleRetryStage = async (stage: PipelineStage) => {
    setRetryingStage(stage);
    try {
      const { error } = await supabase.functions.invoke("run-review-pipeline", {
        body: { plan_review_id: planReviewId, stage },
      });
      if (error) throw error;
      toast.success(`Retrying "${FRIENDLY_LABELS[stage]}"…`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setRetryingStage(null);
    }
  };

  return (
    <ul className={cn("space-y-1.5", className)}>
      {stages
        .filter((s) => VISIBLE_STAGES.includes(s.key))
        .map((s) => {
          const row = byStage.get(s.key);
          const status = row?.status ?? "pending";
          const label = FRIENDLY_LABELS[s.key];
          const hint = FRIENDLY_HINTS[s.key];

          // Stuck detection: status='running' with started_at older than threshold.
          const startedAt = row?.started_at ? new Date(row.started_at).getTime() : 0;
          const isStuck =
            status === "running" &&
            startedAt > 0 &&
            Date.now() - startedAt > STUCK_THRESHOLD_MS;

          return (
            <li
              key={s.key}
              className={cn(
                "flex items-start gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                status === "running" && !isStuck && "bg-accent/10",
                (status === "error" || isStuck) && "bg-destructive/10",
              )}
            >
              <span className="mt-0.5 shrink-0">
                {status === "complete" ? (
                  <Check className="h-4 w-4 text-accent" />
                ) : status === "error" || isStuck ? (
                  <AlertCircle className="h-4 w-4 text-destructive" />
                ) : status === "running" ? (
                  <Loader2 className="h-4 w-4 text-accent animate-spin" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground/40" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "font-medium",
                    status === "pending" && "text-muted-foreground",
                    (status === "error" || isStuck) && "text-destructive",
                  )}
                >
                  {label}
                </span>
                {status === "error" && row?.error_message ? (
                  <span className="ml-2 text-xs text-destructive/80">{row.error_message}</span>
                ) : isStuck ? (
                  <span className="ml-2 text-xs text-destructive/80">
                    Stuck for &gt;{Math.round(STUCK_THRESHOLD_MS / 1000)}s — worker may have died
                  </span>
                ) : status === "running" && hint ? (
                  <span className="ml-2 text-xs text-muted-foreground">{hint}…</span>
                ) : status === "complete" && hint ? (
                  <span className="ml-2 text-xs text-muted-foreground">{hint}</span>
                ) : null}
              </span>
              {(isStuck || status === "error") && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-xs border-destructive/40 text-destructive hover:bg-destructive/10 shrink-0"
                  onClick={() => handleRetryStage(s.key)}
                  disabled={retryingStage === s.key}
                >
                  {retryingStage === s.key ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <>
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Retry
                    </>
                  )}
                </Button>
              )}
            </li>
          );
        })}
    </ul>
  );
}
