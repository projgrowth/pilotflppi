import { cn } from "@/lib/utils";
import { type DeficiencyV2Row } from "@/hooks/useReviewDashboard";
import DeficiencyHeader from "./deficiency/DeficiencyHeader";
import DeficiencyEvidence from "./deficiency/DeficiencyEvidence";
import DeficiencyActions from "./deficiency/DeficiencyActions";

interface Props {
  planReviewId: string;
  def: DeficiencyV2Row;
  showHumanReviewContext?: boolean;
}

export default function DeficiencyCard({
  planReviewId,
  def,
  showHumanReviewContext,
}: Props) {
  const isOverturned = def.verification_status === "overturned";

  return (
    <div
      id={`finding-${def.id}`}
      data-finding-id={def.id}
      className={cn(
        "scroll-mt-24 rounded-lg border bg-card p-4 shadow-sm transition-shadow",
        def.life_safety_flag && "border-destructive/40",
        def.requires_human_review && "border-l-4 border-l-amber-500",
        isOverturned && "opacity-60",
        def.verification_status === "superseded" && "opacity-70 border-dashed",
      )}
    >
      <DeficiencyHeader planReviewId={planReviewId} def={def} />

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

      <div className="mt-2">
        <DeficiencyEvidence def={def} />
      </div>

      <DeficiencyActions planReviewId={planReviewId} def={def} />
    </div>
  );
}
