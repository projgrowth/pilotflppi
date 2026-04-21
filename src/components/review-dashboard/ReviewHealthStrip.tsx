import { useMemo } from "react";
import {
  Activity,
  Brain,
  ShieldCheck,
  AlertTriangle,
  ChevronDown,
  Layers,
} from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  usePipelineStatus,
  useDeficienciesV2,
  useSheetCoverage,
  PIPELINE_STAGES,
  type PipelineStage,
} from "@/hooks/useReviewDashboard";
import { useAppliedCorrections } from "@/hooks/useCorrectionPatterns";
import { StatusPill, type ReviewStatus } from "@/lib/review-status";
import ReviewStatusBar from "./ReviewStatusBar";
import VerificationBanner from "./VerificationBanner";
import ReviewerMemoryCard from "./ReviewerMemoryCard";
import CrossCheckBanner from "./CrossCheckBanner";
import ReviewSummaryHeader from "./ReviewSummaryHeader";

interface Props {
  planReviewId: string;
  status: ReviewStatus;
  projectName: string;
  projectAddress: string;
  jurisdiction: string;
}

interface VerifyMetadata {
  examined?: number;
  upheld?: number;
  overturned?: number;
  modified?: number;
}

interface CrossCheckMetadata {
  duplicate_groups?: unknown[];
  contradictions?: unknown[];
}

interface DedupeMetadata {
  examined?: number;
  groups_merged?: number;
  findings_superseded?: number;
  merges?: Array<{ winner: string; loser_count: number; reason: string }>;
}

export default function ReviewHealthStrip({
  planReviewId,
  status,
  projectName,
  projectAddress,
  jurisdiction,
}: Props) {
  const { data: pipeRows = [] } = usePipelineStatus(planReviewId);
  const { data: defs = [] } = useDeficienciesV2(planReviewId);
  const { data: sheets = [] } = useSheetCoverage(planReviewId);
  const { data: applied = [] } = useAppliedCorrections(planReviewId);

  const currentStage = useMemo<PipelineStage | null>(() => {
    // Last stage that's complete or running, in pipeline order
    let last: PipelineStage | null = null;
    for (const s of PIPELINE_STAGES) {
      const row = pipeRows.find((r) => r.stage === s.key);
      if (row && (row.status === "complete" || row.status === "running")) {
        last = s.key;
      }
    }
    return last;
  }, [pipeRows]);

  const stageLabel = currentStage
    ? PIPELINE_STAGES.find((s) => s.key === currentStage)?.label
    : "Not started";
  const anyError = pipeRows.some((r) => r.status === "error");
  const anyRunning = pipeRows.some((r) => r.status === "running");

  const verifyMeta = useMemo(() => {
    const row = pipeRows.find((r) => r.stage === "verify");
    return ((row as unknown as { metadata?: VerifyMetadata } | undefined)?.metadata ??
      {}) as VerifyMetadata;
  }, [pipeRows]);

  const crossMeta = useMemo(() => {
    const row = pipeRows.find((r) => r.stage === "cross_check");
    return ((row as unknown as { metadata?: CrossCheckMetadata } | undefined)?.metadata ??
      {}) as CrossCheckMetadata;
  }, [pipeRows]);

  const dedupeMeta = useMemo(() => {
    const row = pipeRows.find((r) => r.stage === "dedupe");
    return ((row as unknown as { metadata?: DedupeMetadata } | undefined)?.metadata ??
      {}) as DedupeMetadata;
  }, [pipeRows]);

  const overturned = verifyMeta.overturned ?? 0;
  const upheld = verifyMeta.upheld ?? 0;
  const modified = verifyMeta.modified ?? 0;
  const examined = verifyMeta.examined ?? 0;
  const memoryCount = applied.length;
  const conflictCount =
    (crossMeta.duplicate_groups?.length ?? 0) +
    (crossMeta.contradictions?.length ?? 0);
  const mergedGroups = dedupeMeta.groups_merged ?? 0;
  const supersededCount = dedupeMeta.findings_superseded ?? 0;

  // Live deficiency totals (exclude overturned + superseded duplicates)
  const liveDefs = defs.filter(
    (d) =>
      d.verification_status !== "overturned" &&
      d.verification_status !== "superseded",
  );
  const humanReview = liveDefs.filter(
    (d) => d.requires_human_review && d.status === "open",
  ).length;
  const expectedSheets = sheets.filter((s) => s.expected).length;
  const presentSheets = sheets.filter(
    (s) => s.expected && s.status === "present",
  ).length;

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      {/* Row 1 — identity + status pill + stage */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold">{projectName}</div>
          <div className="truncate text-xs text-muted-foreground">
            {projectAddress} · {jurisdiction}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
              anyError
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : anyRunning
                  ? "border-accent/30 bg-accent/10 text-accent-foreground"
                  : "border-border bg-muted/50 text-muted-foreground",
            )}
          >
            <Activity className="h-3 w-3" />
            <span className="font-mono">{stageLabel}</span>
          </span>
          <StatusPill status={status} />
        </div>
      </div>

      {/* Row 2 — compact metric chips. Click = expand the full banner inline. */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <Chip
          icon={<Activity className="h-3 w-3" />}
          label="Pipeline"
          value={stageLabel ?? "—"}
          tone={anyError ? "danger" : anyRunning ? "accent" : "muted"}
        >
          <ReviewStatusBar planReviewId={planReviewId} />
        </Chip>

        {examined > 0 && (
          <Chip
            icon={<ShieldCheck className="h-3 w-3" />}
            label="Verification"
            value={`${upheld}/${overturned}/${modified}`}
            tone={overturned > 0 ? "warn" : "ok"}
            popoverWidthClass="w-[480px]"
          >
            <VerificationBanner planReviewId={planReviewId} />
          </Chip>
        )}

        {mergedGroups > 0 && (
          <Chip
            icon={<Layers className="h-3 w-3" />}
            label="Dedupe"
            value={`${mergedGroups} group${mergedGroups === 1 ? "" : "s"} · ${supersededCount} merged`}
            tone="muted"
            popoverWidthClass="w-[480px]"
          >
            <DedupeSummary meta={dedupeMeta} />
          </Chip>
        )}

        {memoryCount > 0 && (
          <Chip
            icon={<Brain className="h-3 w-3" />}
            label="Memory"
            value={`${memoryCount} applied`}
            tone="primary"
            popoverWidthClass="w-[520px]"
          >
            <ReviewerMemoryCard planReviewId={planReviewId} />
          </Chip>
        )}

        {conflictCount > 0 && (
          <Chip
            icon={<AlertTriangle className="h-3 w-3" />}
            label="Cross-check"
            value={`${conflictCount} conflict${conflictCount === 1 ? "" : "s"}`}
            tone="warn"
            popoverWidthClass="w-[560px]"
            defaultOpen={false}
          >
            <CrossCheckBanner planReviewId={planReviewId} />
          </Chip>
        )}

        <Chip
          icon={<ShieldCheck className="h-3 w-3" />}
          label="Findings"
          value={`${liveDefs.length} live${humanReview > 0 ? ` · ${humanReview} need eyes` : ""}`}
          tone={humanReview > 0 ? "warn" : "muted"}
          popoverWidthClass="w-[520px]"
        >
          <ReviewSummaryHeader
            planReviewId={planReviewId}
            projectName={projectName}
            projectAddress={projectAddress}
            jurisdiction={jurisdiction}
          />
        </Chip>

        <span className="ml-auto text-2xs font-mono text-muted-foreground">
          Sheets {presentSheets}/{expectedSheets}
        </span>
      </div>
    </div>
  );
}

type ChipTone = "ok" | "warn" | "danger" | "primary" | "accent" | "muted";

function toneCls(tone: ChipTone): string {
  switch (tone) {
    case "ok":
      return "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10";
    case "warn":
      return "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10";
    case "danger":
      return "border-destructive/40 bg-destructive/5 text-destructive hover:bg-destructive/10";
    case "primary":
      return "border-primary/30 bg-primary/5 text-primary hover:bg-primary/10";
    case "accent":
      return "border-accent/40 bg-accent/10 text-accent-foreground hover:bg-accent/20";
    case "muted":
    default:
      return "border-border bg-muted/40 text-muted-foreground hover:bg-muted/70";
  }
}

function Chip({
  icon,
  label,
  value,
  tone,
  children,
  popoverWidthClass = "w-[420px]",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: ChipTone;
  children: React.ReactNode;
  popoverWidthClass?: string;
  defaultOpen?: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
            toneCls(tone),
          )}
        >
          {icon}
          <span className="font-medium">{label}</span>
          <span className="font-mono text-foreground">{value}</span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn("max-h-[480px] overflow-auto p-2", popoverWidthClass)}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

function DedupeSummary({ meta }: { meta: DedupeMetadata }) {
  const merges = meta.merges ?? [];
  return (
    <div className="space-y-2 p-2">
      <div className="flex items-center justify-between border-b pb-1.5">
        <div className="text-xs font-semibold">Cross-discipline dedupe</div>
        <div className="font-mono text-2xs text-muted-foreground">
          {meta.examined ?? 0} examined · {meta.findings_superseded ?? 0} merged
        </div>
      </div>
      <p className="text-2xs text-muted-foreground">
        Same code section flagged by multiple disciplines on overlapping sheets — losers were
        marked superseded and waived. Open a finding and flip status back to "open" if a
        merge looks wrong.
      </p>
      {merges.length === 0 ? (
        <div className="py-3 text-center text-2xs text-muted-foreground">
          No duplicates detected.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {merges.slice(0, 8).map((m, i) => (
            <li
              key={i}
              className="rounded border border-border/60 bg-muted/30 p-1.5 text-2xs"
            >
              <div className="font-mono text-muted-foreground">
                +{m.loser_count} merged
              </div>
              <div className="mt-0.5 leading-snug">{m.reason}</div>
            </li>
          ))}
          {merges.length > 8 && (
            <li className="text-center text-2xs text-muted-foreground">
              +{merges.length - 8} more
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
