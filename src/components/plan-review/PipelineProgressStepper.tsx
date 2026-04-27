import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Check, AlertCircle, Circle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  usePipelineStatus,
  PIPELINE_STAGES,
  CORE_STAGE_KEYS,
  DEEP_STAGE_KEYS,
  type PipelineStage,
  type PipelineMode,
} from "@/hooks/useReviewDashboard";

interface PipelineProgressStepperProps {
  planReviewId: string;
  className?: string;
  /** Optional callback fired exactly once when the terminal stage of the active mode lands. */
  onComplete?: () => void;
  /** Hide stages that aren't part of the typical user-facing flow (kept verbose by default). */
  compact?: boolean;
  /**
   * Which pipeline this stepper is rendering. Defaults to "core" — the fast
   * first-pass path. Pass "deep" to render the optional QA chain instead.
   */
  mode?: PipelineMode;
}

const FRIENDLY_LABELS: Record<PipelineStage, string> = {
  upload: "Upload",
  prepare_pages: "Prepare pages",
  sheet_map: "Sheet map",
  submittal_check: "Submittal check",
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
  prepare_pages: "Validating pre-rendered page manifest",
  sheet_map: "Indexing sheets",
  submittal_check: "Verifying required trades are present",
  dna_extract: "Reading title block & code data",
  discipline_review: "Architectural, structural, MEP, life safety…",
  verify: "Cross-checking findings against evidence",
  ground_citations: "Matching FBC sections",
  dedupe: "Merging overlapping findings",
  cross_check: "Looking for cross-sheet mismatches",
  deferred_scope: "Detecting deferred submittals",
  prioritize: "Ranking by severity",
  complete: "Drafting comment letter",
};

// A stage is considered "stuck" if it's been in the `running` state without
// any heartbeat for this long. Edge workers normally complete a stage chunk
// in ≤ 30s; 90s gives plenty of headroom for cold starts before we offer
// the user a retry nudge.
const STUCK_THRESHOLD_MS = 90_000;

interface DisciplineReviewProgress {
  discipline: string;
  chunk: number;
  total: number;
  findings_so_far: number;
  last_chunk_at: string;
}

/**
 * Subscribe to ai_run_progress.discipline_review_progress so the stepper can
 * render "Architectural — chunk 5 of 10 (8 findings so far)" live and avoid
 * looking frozen during a slow Gemini chunk.
 */
function useDisciplineReviewProgress(planReviewId: string): DisciplineReviewProgress | null {
  const [progress, setProgress] = useState<DisciplineReviewProgress | null>(null);
  useEffect(() => {
    let cancelled = false;
    const fetchOnce = async () => {
      const { data } = await supabase
        .from("plan_reviews")
        .select("ai_run_progress")
        .eq("id", planReviewId)
        .maybeSingle();
      if (cancelled) return;
      const p = (data?.ai_run_progress as Record<string, unknown> | null)
        ?.discipline_review_progress as DisciplineReviewProgress | undefined;
      setProgress(p ?? null);
    };
    void fetchOnce();
    const channel = supabase
      .channel(`pr-progress-${planReviewId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "plan_reviews", filter: `id=eq.${planReviewId}` },
        (payload) => {
          const next = (payload.new as { ai_run_progress?: Record<string, unknown> | null } | null)
            ?.ai_run_progress;
          const p = (next as Record<string, unknown> | null)?.discipline_review_progress as
            | DisciplineReviewProgress
            | undefined;
          setProgress(p ?? null);
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [planReviewId]);
  return progress;
}

export function PipelineProgressStepper({
  planReviewId,
  className,
  onComplete,
  compact = false,
  mode = "core",
}: PipelineProgressStepperProps) {
  const { data: rows = [] } = usePipelineStatus(planReviewId);
  const disciplineProgress = useDisciplineReviewProgress(planReviewId);
  const [retryingStage, setRetryingStage] = useState<PipelineStage | null>(null);
  // Tick every 15s so the "stuck" detector re-evaluates without waiting for
  // a realtime row update (a stuck row by definition isn't getting updates).
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  // Track which (stage, started_at) attempts we've already auto-retried so we
  // never restart the same stuck attempt twice. Cap auto-retries per stage at 2.
  const autoRetryLog = useRef<Map<PipelineStage, { count: number; lastStartedAt: string | null }>>(
    new Map(),
  );

  // Active stage list comes from the mode. The stepper only renders stages
  // that the running pipeline will actually execute — no more "hidden work"
  // gap that made the dashboard feel stalled.
  const visibleKeys = useMemo<PipelineStage[]>(
    () => (mode === "deep" ? DEEP_STAGE_KEYS : CORE_STAGE_KEYS),
    [mode],
  );
  // Terminal stage of whichever chain we're rendering.
  const terminalKey = visibleKeys[visibleKeys.length - 1];

  const byStage = useMemo(() => {
    const m = new Map<PipelineStage, (typeof rows)[number]>();
    for (const r of rows) m.set(r.stage as PipelineStage, r);
    return m;
  }, [rows]);

  // Fire onComplete exactly once per pipeline-completion transition.
  // Latch on the terminal row's started_at so a fresh run (new started_at)
  // re-arms the callback. Using an effect (not render-body queueMicrotask)
  // prevents an invalidation→refetch→render→fire loop that crashed mobile.
  const firedForRef = useRef<string | null>(null);
  useEffect(() => {
    const row = byStage.get(terminalKey);
    const key = row?.started_at ?? null;
    if (row?.status === "complete" && onComplete && firedForRef.current !== key) {
      firedForRef.current = key;
      onComplete();
    }
    if (row?.status !== "complete") firedForRef.current = null;
  }, [byStage, terminalKey, onComplete]);

  const stages = compact
    ? PIPELINE_STAGES.filter((s) => visibleKeys.includes(s.key))
    : PIPELINE_STAGES;

  const handleRetryStage = async (stage: PipelineStage, opts?: { auto?: boolean }) => {
    setRetryingStage(stage);
    try {
      const { error } = await supabase.functions.invoke("run-review-pipeline", {
        body: { plan_review_id: planReviewId, stage, mode },
      });
      if (error) throw error;
      if (opts?.auto) {
        toast.warning(`"${FRIENDLY_LABELS[stage]}" stalled — auto-restarting…`, {
          description: "The worker stopped responding after 90s. Nudging it with a fresh attempt.",
        });
      } else {
        toast.success(`Retrying "${FRIENDLY_LABELS[stage]}"…`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setRetryingStage(null);
    }
  };

  // Auto-retry watcher: any visible stage that's been `running` past the stuck
  // threshold gets one nudge per attempt, capped at 2 auto-retries per stage.
  useEffect(() => {
    for (const row of rows) {
      const stage = row.stage as PipelineStage;
      if (!visibleKeys.includes(stage)) continue;
      if (row.status !== "running" || !row.started_at) continue;

      const startedAtMs = new Date(row.started_at).getTime();
      if (Date.now() - startedAtMs <= STUCK_THRESHOLD_MS) continue;

      const log = autoRetryLog.current.get(stage) ?? { count: 0, lastStartedAt: null };
      if (log.lastStartedAt === row.started_at) continue;
      if (log.count >= 2) continue;

      autoRetryLog.current.set(stage, {
        count: log.count + 1,
        lastStartedAt: row.started_at,
      });
      void handleRetryStage(stage, { auto: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, planReviewId, visibleKeys]);

  return (
    <ul className={cn("space-y-1.5", className)}>
      {stages
        .filter((s) => visibleKeys.includes(s.key))
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
                    Stuck for &gt;{Math.round(STUCK_THRESHOLD_MS / 1000)}s
                    {(() => {
                      const c = autoRetryLog.current.get(s.key)?.count ?? 0;
                      if (c === 0) return " — auto-restarting…";
                      if (c < 2) return ` — auto-restarted ${c}× (will try again)`;
                      return ` — auto-restarted ${c}× (max reached, retry manually)`;
                    })()}
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
