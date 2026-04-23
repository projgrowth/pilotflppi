import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { type DeficiencyV2Row } from "@/hooks/useReviewDashboard";
import DeficiencyHeader from "./deficiency/DeficiencyHeader";
import DeficiencyEvidence from "./deficiency/DeficiencyEvidence";
import DeficiencyActions from "./deficiency/DeficiencyActions";
import FindingProvenancePopover from "./FindingProvenancePopover";
import CitationBadge from "./CitationBadge";

interface Props {
  planReviewId: string;
  def: DeficiencyV2Row;
  showHumanReviewContext?: boolean;
  /** Triage props — optional so legacy callers (HumanReviewQueue) still work. */
  isActive?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
  onFocus?: (id: string) => void;
}

export default function DeficiencyCard({
  planReviewId,
  def,
  showHumanReviewContext,
  isActive,
  isSelected,
  onToggleSelect,
  onFocus,
}: Props) {
  const isOverturned = def.verification_status === "overturned";
  const reviewed = def.reviewer_disposition !== null;
  // Collapsed-by-default when not active. Notes textarea, status select, and
  // provenance only render on focus — halves visual noise on a 20-card page.
  const expanded = !!isActive;

  // Worst-flag rail: one color, one badge, full set in tooltip.
  const worstFlag = def.life_safety_flag
    ? { label: "LIFE SAFETY", rail: "bg-destructive", badge: "bg-destructive text-destructive-foreground" }
    : def.permit_blocker
      ? { label: "BLOCKER", rail: "bg-destructive/70", badge: "bg-destructive/70 text-destructive-foreground" }
      : def.requires_human_review
        ? { label: "NEEDS EYES", rail: "bg-amber-500", badge: "bg-amber-500 text-white" }
        : def.liability_flag
          ? { label: "LIABILITY", rail: "bg-amber-400", badge: "bg-amber-400 text-foreground" }
          : null;

  return (
    <div
      id={`finding-${def.id}`}
      data-finding-id={def.id}
      onClick={onFocus ? () => onFocus(def.id) : undefined}
      className={cn(
        "scroll-mt-24 relative overflow-hidden rounded-lg border bg-card shadow-sm transition-all",
        isOverturned && "opacity-60",
        def.verification_status === "superseded" && "opacity-70 border-dashed",
        isActive && "ring-2 ring-primary",
        isSelected && "bg-primary/5",
      )}
    >
      {/* Single colored left rail encoding the worst flag */}
      {worstFlag && <div className={cn("absolute left-0 top-0 h-full w-1", worstFlag.rail)} />}

      <div className="flex items-start gap-2 p-4 pl-5">
        {onToggleSelect && (
          <Checkbox
            className="mt-1"
            checked={!!isSelected}
            onCheckedChange={() => onToggleSelect(def.id)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select ${def.def_number}`}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <DeficiencyHeader planReviewId={planReviewId} def={def} />
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {worstFlag && (
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                    worstFlag.badge,
                  )}
                  title={[
                    def.life_safety_flag && "Life Safety",
                    def.permit_blocker && "Permit Blocker",
                    def.liability_flag && "Liability",
                    def.requires_human_review && "Needs Human Eyes",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                >
                  {worstFlag.label}
                </span>
              )}
              <CitationBadge
                status={def.citation_status}
                matchScore={def.citation_match_score}
                canonicalText={def.citation_canonical_text}
              />
              {reviewed && (
                <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                  {def.reviewer_disposition}
                </span>
              )}
              {expanded && <FindingProvenancePopover def={def} />}
            </div>
          </div>

          {showHumanReviewContext && def.requires_human_review && (
            <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs space-y-1">
              {def.human_review_reason && (
                <div>
                  <span className="font-medium">Why: </span>
                  {def.human_review_reason}
                </div>
              )}
              {def.human_review_verify && (
                <div>
                  <span className="font-medium">Verify: </span>
                  {def.human_review_verify}
                </div>
              )}
              {def.human_review_method && (
                <div>
                  <span className="font-medium">How: </span>
                  {def.human_review_method}
                </div>
              )}
            </div>
          )}

          {/* Evidence panel only when active — too dense to surface for every collapsed card */}
          {expanded && (
            <div className="mt-2">
              <DeficiencyEvidence planReviewId={planReviewId} def={def} />
            </div>
          )}

          <DeficiencyActions planReviewId={planReviewId} def={def} expanded={expanded} />
        </div>
      </div>
    </div>
  );
}
