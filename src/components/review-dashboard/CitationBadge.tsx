import { CheckCircle2, AlertTriangle, HelpCircle, XCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type CitationStatus =
  | "verified"
  | "mismatch"
  | "not_found"
  | "hallucinated"
  | "unverified"
  | string;

interface Props {
  status: CitationStatus | null | undefined;
  matchScore?: number | null;
  canonicalText?: string | null;
  /** Compact icon-only mode for dense lists. */
  compact?: boolean;
}

/**
 * Surfaces whether the AI's cited code section was matched against the
 * canonical FBC database. Lets reviewers spot hallucinated or mismatched
 * citations at a glance.
 */
export default function CitationBadge({
  status,
  matchScore,
  canonicalText,
  compact,
}: Props) {
  if (!status || status === "unverified") return null;

  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.unverified;
  const Icon = cfg.icon;
  const score =
    typeof matchScore === "number" ? `${Math.round(matchScore * 100)}%` : null;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex h-5 items-center gap-1 rounded border px-1.5 text-2xs font-medium",
              cfg.classes,
              compact && "h-4 px-1",
            )}
            aria-label={`Citation ${cfg.label}`}
          >
            <Icon className={cn("h-3 w-3", compact && "h-2.5 w-2.5")} />
            {!compact && <span>{cfg.label}</span>}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs space-y-1">
          <div className="font-semibold">Citation: {cfg.label}</div>
          <div className="text-2xs opacity-90">{cfg.description}</div>
          {score && (
            <div className="text-2xs opacity-80">Text overlap: {score}</div>
          )}
          {canonicalText && (
            <div className="border-t border-border/40 pt-1 text-2xs italic opacity-80">
              "{canonicalText.slice(0, 140)}
              {canonicalText.length > 140 ? "…" : ""}"
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const STATUS_CONFIG: Record<
  string,
  {
    label: string;
    description: string;
    icon: typeof CheckCircle2;
    classes: string;
  }
> = {
  verified: {
    label: "Verified",
    description:
      "Citation matched canonical FBC text — finding is grounded in code.",
    icon: CheckCircle2,
    classes:
      "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  mismatch: {
    label: "Mismatch",
    description:
      "Section exists but the AI's wording diverges from the canonical requirement. Verify before sending.",
    icon: AlertTriangle,
    classes:
      "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  not_found: {
    label: "Not in DB",
    description:
      "Cited section isn't in the canonical FBC database yet. Confirm the section exists.",
    icon: HelpCircle,
    classes:
      "border-muted-foreground/40 bg-muted text-muted-foreground",
  },
  hallucinated: {
    label: "Hallucinated",
    description:
      "No parseable code section in the citation — likely an AI hallucination. Reject or rewrite.",
    icon: XCircle,
    classes:
      "border-destructive/40 bg-destructive/10 text-destructive",
  },
  unverified: {
    label: "Unverified",
    description: "Citation has not been grounded against the FBC database.",
    icon: HelpCircle,
    classes: "border-border bg-muted text-muted-foreground",
  },
};
