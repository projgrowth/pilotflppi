import { useMemo, useState } from "react";
import { ShieldCheck, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePipelineStatus } from "@/hooks/useReviewDashboard";

interface VerifyMetadata {
  examined?: number;
  upheld?: number;
  overturned?: number;
  modified?: number;
  skipped?: number;
}

interface Props {
  planReviewId: string;
}

export default function VerificationBanner({ planReviewId }: Props) {
  const { data: rows = [] } = usePipelineStatus(planReviewId);
  const [open, setOpen] = useState(false);

  const meta = useMemo(() => {
    const row = rows.find((r) => r.stage === "verify");
    return ((row as unknown as { metadata?: VerifyMetadata } | undefined)?.metadata ??
      {}) as VerifyMetadata;
  }, [rows]);

  const examined = meta.examined ?? 0;
  if (examined === 0) return null;

  const upheld = meta.upheld ?? 0;
  const overturned = meta.overturned ?? 0;
  const modified = meta.modified ?? 0;
  const skipped = meta.skipped ?? 0;

  return (
    <div
      className={cn(
        "rounded-lg border bg-emerald-500/5 dark:bg-emerald-500/10",
        "border-emerald-500/40",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span className="text-sm font-medium">
              Verification pass: {upheld} upheld · {overturned} overturned · {modified} modified
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            {examined} finding{examined === 1 ? "" : "s"} re-examined
            {skipped > 0 ? ` · ${skipped} skipped` : ""}
          </span>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="border-t border-emerald-500/30 px-4 py-3 text-xs text-muted-foreground">
          <p>
            Every low-confidence and high-priority finding was re-checked by a second AI pass acting
            as a senior plans examiner challenging the original conclusion.
          </p>
          <ul className="mt-2 space-y-1">
            <li>
              <strong className="text-emerald-700 dark:text-emerald-400">Upheld ({upheld})</strong>{" "}
              — confidence was bumped and the finding stands.
            </li>
            <li>
              <strong className="text-destructive">Overturned ({overturned})</strong> — flagged as
              false positives, hidden from the comment letter and the county report.
            </li>
            <li>
              <strong className="text-amber-700 dark:text-amber-400">Modified ({modified})</strong>{" "}
              — finding text was corrected and flagged for human confirmation.
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
