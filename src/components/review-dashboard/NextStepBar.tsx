/**
 * NextStepBar — single-CTA guidance for "what to do next".
 *
 * Reads the existing dashboard state (pipeline status, deficiencies,
 * letter draft, qc status) and surfaces ONE next action so reviewers
 * never have to invent a workflow.
 *
 * Steps:
 *   1. Pipeline running   → "AI is analyzing your plans"
 *   2. Triage             → N findings need a disposition
 *   3. Generate letter    → letter draft empty/stale
 *   4. QC sign-off        → qc_status === 'pending_qc'
 *   5. Done               → quietly hide
 */
import { useMemo } from "react";
import { Loader2, Inbox, FileText, ShieldCheck, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PipelineRow {
  stage: string;
  status: string;
}

interface DefRow {
  reviewer_disposition: string | null;
  verification_status: string;
  status: string;
}

interface Props {
  pipelineRows: PipelineRow[];
  deficiencies: DefRow[];
  letterDraft: string | null | undefined;
  qcStatus: string | null | undefined;
  onTriage: () => void;
  onGenerateLetter: () => void;
  onReviewLetter: () => void;
}

export default function NextStepBar({
  pipelineRows,
  deficiencies,
  letterDraft,
  qcStatus,
  onTriage,
  onGenerateLetter,
  onReviewLetter,
}: Props) {
  const step = useMemo(() => {
    const pipelineActive = pipelineRows.some(
      (r) => r.status === "running" || r.status === "pending",
    );
    if (pipelineActive) {
      return {
        n: 1,
        title: "AI is analyzing your plans",
        cta: null as null | { label: string; onClick: () => void },
        icon: Loader2,
        spin: true,
      };
    }

    const live = deficiencies.filter(
      (d) =>
        d.verification_status !== "overturned" &&
        d.verification_status !== "superseded",
    );
    const untriaged = live.filter((d) => d.reviewer_disposition === null).length;
    if (untriaged > 0) {
      return {
        n: 2,
        title: `Triage ${untriaged} finding${untriaged === 1 ? "" : "s"}`,
        cta: { label: "Start triage", onClick: onTriage },
        icon: Inbox,
        spin: false,
      };
    }

    if (!letterDraft || letterDraft.trim().length < 50) {
      return {
        n: 3,
        title: "Generate the comment letter",
        cta: { label: "Open letter", onClick: onGenerateLetter },
        icon: FileText,
        spin: false,
      };
    }

    if (qcStatus === "pending_qc" || qcStatus === "draft" || !qcStatus) {
      return {
        n: 4,
        title: "Review and send the letter",
        cta: { label: "Open letter", onClick: onReviewLetter },
        icon: ShieldCheck,
        spin: false,
      };
    }

    return null;
  }, [pipelineRows, deficiencies, letterDraft, qcStatus, onTriage, onGenerateLetter, onReviewLetter]);

  if (!step) return null;
  const Icon = step.icon;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Icon className={cn("h-4 w-4", step.spin && "animate-spin")} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-2xs font-mono uppercase tracking-wide text-muted-foreground">
          Step {step.n} of 4
        </div>
        <div className="text-sm font-medium">{step.title}</div>
      </div>
      {step.cta && (
        <Button size="sm" onClick={step.cta.onClick} className="shrink-0">
          {step.cta.label}
          <ArrowRight className="ml-1 h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
