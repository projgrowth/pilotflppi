/**
 * DNAConfirmCard
 *
 * Surfaces a one-click confirm card right after `dna_extract` completes,
 * before the reviewer dives into discipline findings. Project DNA
 * (occupancy, construction type, county, FBC edition, wind speed, etc.)
 * drives every downstream check — if occupancy is wrong, every life-safety
 * finding is suspect. A 30-second sanity check by a human prevents that
 * cascade.
 *
 * Confirmation is persisted as `dna_confirmed_at` inside
 * `plan_reviews.ai_run_progress` so we don't need a schema change. Once
 * confirmed (or after the reviewer chooses Edit), the card hides itself.
 *
 * "Edit" scrolls the reviewer to the existing ProjectDNAViewer where they
 * can change values — those edits already trigger a partial pipeline
 * re-run from `verify` via the viewer's onAfterRerun hook.
 */

import { useMemo, useState } from "react";
import { CheckCircle2, AlertTriangle, Pencil, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useProjectDna } from "@/hooks/useReviewDashboard";

interface Props {
  planReviewId: string;
  /** From plan_reviews.ai_run_progress — pass the JSONB object as-is. */
  aiRunProgress: Record<string, unknown> | null | undefined;
  /** When true, the reviewer can scroll to / focus the existing DNA editor. */
  onEdit?: () => void;
}

export default function DNAConfirmCard({
  planReviewId,
  aiRunProgress,
  onEdit,
}: Props) {
  const { data: dna } = useProjectDna(planReviewId);
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  const alreadyConfirmed = useMemo(() => {
    const v = (aiRunProgress ?? {}) as Record<string, unknown>;
    return typeof v.dna_confirmed_at === "string" && v.dna_confirmed_at.length > 0;
  }, [aiRunProgress]);

  // Hide until DNA actually exists (i.e. dna_extract has run).
  if (!dna || alreadyConfirmed) return null;

  const ambiguousCount = (dna.ambiguous_fields ?? []).length;
  const missingCount = (dna.missing_fields ?? []).length;

  const summary: Array<[string, string]> = [];
  if (dna.occupancy_classification) summary.push(["Occupancy", dna.occupancy_classification]);
  if (dna.construction_type) summary.push(["Construction", dna.construction_type]);
  if (dna.county) summary.push(["County", dna.county]);
  if (dna.fbc_edition) summary.push(["FBC", dna.fbc_edition]);
  if (typeof dna.stories === "number") summary.push(["Stories", String(dna.stories)]);
  if (typeof dna.total_sq_ft === "number") summary.push(["Sq Ft", dna.total_sq_ft.toLocaleString()]);
  if (dna.hvhz === true) summary.push(["HVHZ", "Yes"]);
  if (dna.is_coastal === true) summary.push(["Coastal", "Yes"]);
  if (dna.flood_zone) summary.push(["Flood", dna.flood_zone]);
  if (typeof dna.wind_speed_vult === "number") summary.push(["Wind Vult", `${dna.wind_speed_vult} mph`]);
  if (typeof dna.occupant_load === "number") summary.push(["Occ Load", dna.occupant_load.toLocaleString()]);

  const handleConfirm = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const { data: prev } = await supabase
        .from("plan_reviews")
        .select("ai_run_progress")
        .eq("id", planReviewId)
        .maybeSingle();
      const progress =
        ((prev as { ai_run_progress?: Record<string, unknown> | null } | null)
          ?.ai_run_progress ?? {}) as Record<string, unknown>;
      const next = {
        ...progress,
        dna_confirmed_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from("plan_reviews")
        .update({ ai_run_progress: next as never })
        .eq("id", planReviewId);
      if (error) throw error;
      toast.success("Project DNA confirmed.");
      qc.invalidateQueries({ queryKey: ["plan-review", planReviewId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to confirm DNA");
    } finally {
      setSaving(false);
    }
  };

  const hasWarnings = ambiguousCount > 0 || missingCount > 0;

  return (
    <div
      className={
        "rounded-lg border bg-card p-3 shadow-sm " +
        (hasWarnings
          ? "border-amber-500/40 bg-amber-500/5"
          : "border-primary/30 bg-primary/5")
      }
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          {hasWarnings ? (
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-primary" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">
            Confirm project DNA before reviewing findings
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            These values drive every code check. A 30-second sanity check now prevents
            cascading errors in the comment letter.
            {hasWarnings && (
              <span className="ml-1 font-medium text-amber-700">
                {ambiguousCount > 0 && `${ambiguousCount} ambiguous`}
                {ambiguousCount > 0 && missingCount > 0 && ", "}
                {missingCount > 0 && `${missingCount} missing`}
                {" — review carefully."}
              </span>
            )}
          </p>
          {summary.length > 0 && (
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-2xs sm:grid-cols-3">
              {summary.map(([k, v]) => (
                <div key={k} className="flex items-baseline gap-1.5 truncate">
                  <span className="text-muted-foreground">{k}:</span>
                  <span className="truncate font-mono font-medium text-foreground">{v}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" onClick={handleConfirm} disabled={saving} className="h-7 text-xs">
              {saving ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-1 h-3 w-3" />
              )}
              Looks right — confirm
            </Button>
            {onEdit && (
              <Button
                size="sm"
                variant="outline"
                onClick={onEdit}
                className="h-7 text-xs"
              >
                <Pencil className="mr-1 h-3 w-3" />
                Edit values
              </Button>
            )}
            <span className="ml-auto text-2xs text-muted-foreground">
              ~30 seconds
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
