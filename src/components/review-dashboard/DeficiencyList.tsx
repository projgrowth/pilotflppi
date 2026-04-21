import { useEffect, useMemo, useState } from "react";
import { Keyboard } from "lucide-react";
import { useFilteredDeficiencies } from "@/hooks/useFilteredDeficiencies";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useTriageController } from "@/hooks/useTriageController";
import { type DeficiencyV2Row } from "@/hooks/useReviewDashboard";
import DeficiencyCard from "./DeficiencyCard";
import BulkActionBar from "./BulkActionBar";
import TriageShortcutsOverlay from "./TriageShortcutsOverlay";
import RejectionReasonDialog from "./RejectionReasonDialog";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  recordCorrectionPattern,
  type RejectionReason,
} from "@/hooks/useCorrectionPatterns";
import { updateDeficiencyDisposition } from "@/hooks/useReviewDashboard";

interface Props {
  planReviewId: string;
}

/** Fired by the dedupe audit trail when jumping to a superseded loser. */
const FORCE_SHOW_EVENT = "fpp:show-superseded";
export function requestShowSuperseded() {
  window.dispatchEvent(new CustomEvent(FORCE_SHOW_EVENT));
}

export default function DeficiencyList({ planReviewId }: Props) {
  const qc = useQueryClient();
  const [showSuperseded, setShowSuperseded] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<DeficiencyV2Row | null>(null);
  const [rejectSaving, setRejectSaving] = useState(false);

  useEffect(() => {
    const handler = () => setShowSuperseded(true);
    window.addEventListener(FORCE_SHOW_EVENT, handler);
    return () => window.removeEventListener(FORCE_SHOW_EVENT, handler);
  }, []);

  const { isLoading, items, grouped, counts } = useFilteredDeficiencies(planReviewId, {
    hideOverturned: true,
    showSuperseded,
    groupBy: "discipline",
  });

  const triage = useTriageController({
    planReviewId,
    items,
    enabled: !isLoading && items.length > 0,
    onRequestReject: (def) => setRejectTarget(def),
  });

  const selectedRows = useMemo(
    () => items.filter((d) => triage.selectedIds.has(d.id)),
    [items, triage.selectedIds],
  );

  async function handleRejectConfirm(reason: RejectionReason, notes: string) {
    if (!rejectTarget) return;
    setRejectSaving(true);
    try {
      await updateDeficiencyDisposition(rejectTarget.id, {
        reviewer_disposition: "reject",
        status: "waived",
      });
      const { data: auth } = await supabase.auth.getUser();
      await supabase.from("review_feedback").insert({
        plan_review_id: planReviewId,
        deficiency_id: rejectTarget.id,
        feedback_type: `reject_${reason}`,
        notes: notes || null,
        reviewer_id: auth?.user?.id ?? null,
      });
      await recordCorrectionPattern({
        planReviewId,
        deficiency: {
          id: rejectTarget.id,
          discipline: rejectTarget.discipline,
          finding: rejectTarget.finding,
          required_action: rejectTarget.required_action,
          code_reference: rejectTarget.code_reference,
        },
        reason,
        notes,
      });
      qc.invalidateQueries({ queryKey: ["deficiencies_v2", planReviewId] });
      qc.invalidateQueries({ queryKey: ["correction_patterns"] });
      toast.success("Rejected — pattern saved");
      setRejectTarget(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save rejection");
    } finally {
      setRejectSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        Loading deficiencies…
      </div>
    );
  }
  if (counts.total === 0) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
        No deficiencies recorded yet for this review.
      </div>
    );
  }

  const supersededCount = counts.total - counts.visible;
  const progressPct =
    triage.totalCount > 0 ? Math.round((triage.reviewedCount / triage.totalCount) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Triage progress + shortcut hint */}
      <div className="rounded-md border bg-card p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1">
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-medium">
                Triage progress · {triage.reviewedCount} of {triage.totalCount}
              </span>
              <span className="font-mono text-muted-foreground">{progressPct}%</span>
            </div>
            <Progress value={progressPct} className="h-1.5" />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-2xs"
            onClick={() => triage.setShortcutsOpen(true)}
          >
            <Keyboard className="h-3 w-3" />
            Shortcuts
          </Button>
        </div>
      </div>

      <BulkActionBar
        planReviewId={planReviewId}
        selected={selectedRows}
        onClear={triage.clearSelection}
      />

      <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
        <div className="text-xs text-muted-foreground">
          {counts.visible} live finding{counts.visible === 1 ? "" : "s"}
          {supersededCount > 0 && !showSuperseded && (
            <span className="ml-2">· {supersededCount} hidden (superseded/overturned)</span>
          )}
          <span className="ml-2 text-2xs">· Press <kbd className="rounded border bg-background px-1 font-mono">?</kbd> for shortcuts</span>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="show-superseded"
            checked={showSuperseded}
            onCheckedChange={setShowSuperseded}
          />
          <Label htmlFor="show-superseded" className="cursor-pointer text-xs">
            Show superseded
          </Label>
        </div>
      </div>

      {grouped.map(([discipline, groupItems]) => (
        <section key={discipline}>
          <h3 className="mb-2 text-sm font-semibold capitalize">
            {discipline.replace(/_/g, " ")}{" "}
            <span className="text-xs font-normal text-muted-foreground">
              ({groupItems.length})
            </span>
          </h3>
          <div className="space-y-3">
            {groupItems.map((d) => (
              <DeficiencyCard
                key={d.id}
                planReviewId={planReviewId}
                def={d}
                isActive={triage.activeId === d.id}
                isSelected={triage.selectedIds.has(d.id)}
                onToggleSelect={triage.toggleSelect}
                onFocus={triage.setActiveId}
              />
            ))}
          </div>
        </section>
      ))}

      <TriageShortcutsOverlay
        open={triage.shortcutsOpen}
        onOpenChange={triage.setShortcutsOpen}
      />
      <RejectionReasonDialog
        open={!!rejectTarget}
        onOpenChange={(o) => !o && setRejectTarget(null)}
        defNumber={rejectTarget?.def_number ?? ""}
        finding={rejectTarget?.finding ?? ""}
        saving={rejectSaving}
        onConfirm={handleRejectConfirm}
      />
    </div>
  );
}
