/**
 * Banner that surfaces the result of the `submittal_check` pipeline stage.
 *
 * The stage runs on every commercial review. When it determines that one or
 * more required disciplines (Structural, MEP, Civil, Fire Protection) are
 * missing from the uploaded sheet set, it sets:
 *
 *   ai_run_progress.submittal_incomplete = true
 *   ai_run_progress.submittal_missing_disciplines = ["Structural", "MEP", ...]
 *
 * and opens a permit-blocker finding (DEF-SUB001).
 *
 * This banner reads those flags directly off the `plan_reviews.ai_run_progress`
 * jsonb. No extra query, no new RLS surface area.
 */
import { AlertTriangle } from "lucide-react";

interface Props {
  /** Pulled from `plan_reviews.ai_run_progress`. */
  progress: Record<string, unknown> | null | undefined;
  /** Click handler for the "View finding" button — scrolls to DEF-SUB001 if present. */
  onViewFinding?: () => void;
}

export function SubmittalIncompleteBanner({ progress, onViewFinding }: Props) {
  if (!progress) return null;

  const incomplete = progress.submittal_incomplete === true;
  if (!incomplete) return null;

  const missingRaw = progress.submittal_missing_disciplines;
  const missing = Array.isArray(missingRaw)
    ? missingRaw.filter((d): d is string => typeof d === "string")
    : [];

  return (
    <div className="shrink-0 mx-4 mt-2 rounded-md border border-warning/50 bg-warning/10 px-3 py-2 flex items-start gap-2.5">
      <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 space-y-0.5">
        <p className="text-xs font-semibold text-warning uppercase tracking-wide">
          Submittal incomplete
        </p>
        <p className="text-xs text-foreground/85 leading-snug">
          {missing.length > 0 ? (
            <>
              Missing required disciplines:{" "}
              <strong>{missing.join(", ")}</strong>.{" "}
            </>
          ) : (
            <>One or more required disciplines were not detected in this submittal. </>
          )}
          The review continued, but a permit-blocker (DEF-SUB001) has been opened.
          Verify that the missing trades aren't being submitted under a separate
          permit before sending the comment letter.
        </p>
      </div>
      {onViewFinding && (
        <button
          onClick={onViewFinding}
          className="shrink-0 text-2xs font-semibold text-warning hover:underline self-center"
        >
          View finding →
        </button>
      )}
    </div>
  );
}
