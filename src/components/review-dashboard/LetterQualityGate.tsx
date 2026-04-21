import { CheckCircle2, AlertTriangle, AlertCircle, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useDeficienciesV2 } from "@/hooks/useReviewDashboard";
import { useLetterQualityCheck } from "@/hooks/useLetterQualityCheck";
import { scrollToFinding } from "@/lib/finding-jump";
import { requestShowSuperseded } from "./DeficiencyList";

interface Props {
  planReviewId: string;
  letterDraft?: string | null;
  /** Called so the parent can switch tabs back to "deficiencies" before scrolling. */
  onJumpToFinding?: () => void;
}

/**
 * Pre-flight panel. Surfaces every reason the comment letter shouldn't ship
 * yet: undecided dispositions, missing code refs, weak sheet refs, hedge
 * phrasing. Each issue is click-to-jump.
 */
export default function LetterQualityGate({
  planReviewId,
  letterDraft,
  onJumpToFinding,
}: Props) {
  const { data: defs = [] } = useDeficienciesV2(planReviewId);
  const { issues, errorCount, warningCount, green } = useLetterQualityCheck({
    deficiencies: defs,
    letterDraft,
  });
  const [collapsed, setCollapsed] = useState(false);

  const errors = useMemo(() => issues.filter((i) => i.severity === "error"), [issues]);
  const warnings = useMemo(() => issues.filter((i) => i.severity === "warning"), [issues]);

  const handleJump = (findingId?: string) => {
    if (!findingId) return;
    onJumpToFinding?.();
    requestShowSuperseded();
    scrollToFinding(findingId, { delayMs: 80 });
  };

  return (
    <section
      className={cn(
        "rounded-lg border bg-card p-4 shadow-sm",
        green && "border-emerald-500/40 bg-emerald-500/5",
        errorCount > 0 && "border-destructive/40 bg-destructive/5",
        errorCount === 0 && warningCount > 0 && "border-amber-500/40 bg-amber-500/5",
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          {green ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          ) : errorCount > 0 ? (
            <AlertCircle className="mt-0.5 h-5 w-5 text-destructive" />
          ) : (
            <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600 dark:text-amber-400" />
          )}
          <div>
            <div className="text-sm font-semibold">
              {green
                ? "Letter ready to send"
                : errorCount > 0
                  ? `${errorCount} blocking issue${errorCount === 1 ? "" : "s"}`
                  : `${warningCount} warning${warningCount === 1 ? "" : "s"}`}
            </div>
            <div className="text-2xs text-muted-foreground">
              {green
                ? "Every finding has a disposition, code reference, and sheet ref."
                : "Resolve below before generating the contractor letter."}
            </div>
          </div>
        </div>
        {issues.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-2xs"
            onClick={() => setCollapsed((v) => !v)}
          >
            {collapsed ? "Show all" : "Hide"}
          </Button>
        )}
      </header>

      {!collapsed && issues.length > 0 && (
        <ul className="mt-3 space-y-1">
          {errors.map((i) => (
            <IssueRow key={i.code} issue={i} onJump={handleJump} />
          ))}
          {warnings.map((i) => (
            <IssueRow key={i.code} issue={i} onJump={handleJump} />
          ))}
        </ul>
      )}
    </section>
  );
}

function IssueRow({
  issue,
  onJump,
}: {
  issue: ReturnType<typeof useLetterQualityCheck>["issues"][number];
  onJump: (findingId?: string) => void;
}) {
  const isError = issue.severity === "error";
  const interactive = !!issue.findingId;
  const Tag = interactive ? "button" : "div";
  return (
    <li>
      <Tag
        type={interactive ? "button" : undefined}
        onClick={interactive ? () => onJump(issue.findingId) : undefined}
        className={cn(
          "flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-xs",
          interactive && "transition-colors hover:border-border hover:bg-muted/40",
          isError ? "text-destructive" : "text-amber-700 dark:text-amber-300",
        )}
      >
        {isError ? (
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="flex-1">{issue.message}</span>
        {interactive && <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" />}
      </Tag>
    </li>
  );
}
