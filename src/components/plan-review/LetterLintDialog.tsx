import { useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { LintIssue } from "@/lib/letter-linter";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issues: LintIssue[];
  /** True when at least one error blocks send. Cancel becomes the only option. */
  blocked: boolean;
  /** When > 0, the readiness gate had blockers and the reviewer is overriding.
   *  We require a typed reason in that case (audit trail). */
  readinessBlockingCount?: number;
  onConfirmSend: (overrideReason: string) => void;
}

export function LetterLintDialog({
  open,
  onOpenChange,
  issues,
  blocked,
  readinessBlockingCount = 0,
  onConfirmSend,
}: Props) {
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const [overrideReason, setOverrideReason] = useState("");
  const overrideRequired = readinessBlockingCount > 0;
  const overrideValid = !overrideRequired || overrideReason.trim().length >= 12;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setOverrideReason("");
        onOpenChange(o);
      }}
    >
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {blocked ? (
              <><AlertCircle className="h-4 w-4 text-destructive" /> Fix issues before sending</>
            ) : warnings.length > 0 || overrideRequired ? (
              <><AlertTriangle className="h-4 w-4 text-warning" /> Review before sending</>
            ) : (
              <><CheckCircle2 className="h-4 w-4 text-success" /> Ready to send</>
            )}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {blocked
              ? "The letter has blocking issues. Resolve them, then try again."
              : overrideRequired
                ? `${readinessBlockingCount} readiness check${readinessBlockingCount === 1 ? "" : "s"} not met. Type a reason to record the override in the audit log.`
                : warnings.length > 0
                  ? "Confirm the warnings below before sending to the contractor."
                  : "Confirm you want to send this letter to the contractor."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {issues.length > 0 && (
          <div className="space-y-1.5 max-h-[30vh] overflow-y-auto">
            {errors.map((i, idx) => (
              <div key={`e-${idx}`} className="flex items-start gap-2 rounded border border-destructive/30 bg-destructive/5 px-2.5 py-1.5">
                <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                <p className="text-xs text-foreground/85">{i.message}</p>
              </div>
            ))}
            {warnings.map((i, idx) => (
              <div key={`w-${idx}`} className="flex items-start gap-2 rounded border border-warning/30 bg-warning/5 px-2.5 py-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
                <p className="text-xs text-foreground/85">{i.message}</p>
              </div>
            ))}
          </div>
        )}

        {!blocked && overrideRequired && (
          <div className="space-y-1.5">
            <label className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              Override reason (required, min 12 chars)
            </label>
            <Textarea
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value.slice(0, 2000))}
              rows={3}
              placeholder="e.g. AHJ accepted a verbal waiver on §1006 — see email Acme/2026-04-28."
              className="text-xs"
            />
            <p className="text-2xs text-muted-foreground">
              This reason is permanently logged with the letter snapshot.
            </p>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>{blocked ? "Close" : "Cancel"}</AlertDialogCancel>
          {!blocked && (
            <AlertDialogAction
              disabled={!overrideValid}
              onClick={() => {
                onConfirmSend(overrideRequired ? overrideReason.trim() : "");
                setOverrideReason("");
              }}
            >
              {overrideRequired ? "Override & Send" : "Send anyway"}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
