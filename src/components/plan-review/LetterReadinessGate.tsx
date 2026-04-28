/**
 * LetterReadinessGate — checklist banner shown above the Send / Mark Sent /
 * Export PDF actions. Computes status from live findings, qc_status, and
 * project DNA via `computeLetterReadiness`, then renders one row per check
 * with a "Jump to" affordance for blockers.
 *
 * Usage: render this once on the Review Dashboard, near the export buttons.
 * Pass `onJumpToFinding` so blockers can scroll/highlight the offending
 * finding card. The boolean `allRequiredPassing` from the result is what the
 * parent uses to disable the Send button (with an Override option).
 */
import { useMemo } from "react";
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  computeLetterReadiness,
  type ReadinessCheck,
  type ReadinessInput,
  type ReadinessResult,
} from "@/lib/letter-readiness";

interface Props extends ReadinessInput {
  onJumpToFinding?: (findingId: string) => void;
  /** Optional render-prop for the result; lets a parent read counts. */
  onCompute?: (result: ReadinessResult) => void;
  className?: string;
}

export default function LetterReadinessGate({
  findings,
  qcStatus,
  reviewerIsSoleSigner,
  projectDnaMissingFields,
  noticeToBuildingOfficialFiledAt,
  complianceAffidavitSignedAt,
  disciplinesInLetter,
  reviewerLicensedDisciplines,
  isThresholdBuilding,
  thresholdTriggers,
  specialInspectorDesignated,
  coveragePct,
  blockLetterOnLowCoverage,
  blockLetterOnUngrounded,
  onJumpToFinding,
  onCompute,
  className,
}: Props) {
  const result = useMemo(
    () =>
      computeLetterReadiness({
        findings,
        qcStatus,
        reviewerIsSoleSigner,
        projectDnaMissingFields,
        noticeToBuildingOfficialFiledAt,
        complianceAffidavitSignedAt,
        disciplinesInLetter,
        reviewerLicensedDisciplines,
        isThresholdBuilding,
        thresholdTriggers,
        specialInspectorDesignated,
        coveragePct,
        blockLetterOnLowCoverage,
        blockLetterOnUngrounded,
      }),
    [
      findings,
      qcStatus,
      reviewerIsSoleSigner,
      projectDnaMissingFields,
      noticeToBuildingOfficialFiledAt,
      complianceAffidavitSignedAt,
      disciplinesInLetter,
      reviewerLicensedDisciplines,
      isThresholdBuilding,
      thresholdTriggers,
      specialInspectorDesignated,
      coveragePct,
      blockLetterOnLowCoverage,
      blockLetterOnUngrounded,
    ],
  );

  // Surface the result to the parent for its own gating UI (e.g. disabled buttons).
  if (onCompute) onCompute(result);

  const blocking = result.blockingCount;

  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-3",
        blocking > 0
          ? "border-destructive/40 bg-destructive/5"
          : "border-success/30 bg-success/5",
        className,
      )}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          {blocking === 0 ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-success" />
              Ready to send
            </>
          ) : (
            <>
              <AlertCircle className="h-4 w-4 text-destructive" />
              {blocking} item{blocking === 1 ? "" : "s"} blocking send
            </>
          )}
        </div>
      </div>

      <ul className="space-y-1.5">
        {result.checks.map((check) => (
          <CheckRow
            key={check.id}
            check={check}
            onJump={onJumpToFinding}
          />
        ))}
      </ul>
    </div>
  );
}

function CheckRow({
  check,
  onJump,
}: {
  check: ReadinessCheck;
  onJump?: (findingId: string) => void;
}) {
  const Icon =
    check.severity === "ok"
      ? CheckCircle2
      : check.severity === "warn"
        ? AlertTriangle
        : AlertCircle;

  const iconColor =
    check.severity === "ok"
      ? "text-success"
      : check.severity === "warn"
        ? "text-warning"
        : "text-destructive";

  return (
    <li className="flex items-start gap-2 rounded-md px-1 py-1 text-xs">
      <Icon className={cn("mt-0.5 h-3.5 w-3.5 flex-shrink-0", iconColor)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-medium">{check.title}</span>
          {!check.required && (
            <span className="text-2xs uppercase tracking-wide text-muted-foreground">
              advisory
            </span>
          )}
        </div>
        <div className="mt-0.5 text-muted-foreground">{check.detail}</div>
      </div>
      {check.severity !== "ok" && check.jumpFindingId && onJump && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 shrink-0 gap-0.5 px-1.5 text-2xs"
          onClick={() => onJump(check.jumpFindingId!)}
        >
          Jump
          <ArrowRight className="h-3 w-3" />
        </Button>
      )}
    </li>
  );
}
