import { useEffect, useMemo, useState } from "react";
import { Keyboard } from "lucide-react";
import { useFilteredDeficiencies } from "@/hooks/useFilteredDeficiencies";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
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
  /** Optional inline chip filter (driven by FilterChips on the dashboard). */
  chipFilter?: import("@/hooks/useFilteredDeficiencies").ChipFilter;
}

/** Fired by the dedupe audit trail when jumping to a superseded loser. */
const FORCE_SHOW_EVENT = "fpp:show-superseded";
export function requestShowSuperseded() {
  window.dispatchEvent(new CustomEvent(FORCE_SHOW_EVENT));
}

export default function DeficiencyList({ planReviewId, chipFilter }: Props) {
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
    chip: chipFilter,
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

  // Split disposition breakdown — gives reviewers a real signal vs. a single
  // "X reviewed" bar that hid whether findings were accepted, modified, or
  // tossed out.
  const dispoBreakdown = useMemo(() => {
    let confirmed = 0;
    let modified = 0;
    let rejected = 0;
    for (const d of items) {
      if (d.reviewer_disposition === "confirm") confirmed += 1;
      else if (d.reviewer_disposition === "modify") modified += 1;
      else if (d.reviewer_disposition === "reject") rejected += 1;
    }
    const total = triage.totalCount;
    const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
    return {
      confirmed,
      modified,
      rejected,
      pending: Math.max(0, total - confirmed - modified - rejected),
      confirmedPct: pct(confirmed),
      modifiedPct: pct(modified),
      rejectedPct: pct(rejected),
      reviewedPct: total > 0 ? Math.round(((confirmed + modified + rejected) / total) * 100) : 0,
    };
  }, [items, triage.totalCount]);

  return (
    <div className="space-y-4">
      {/* Triage progress + shortcut hint */}
      <div className="rounded-md border bg-card p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="font-medium">
                Reviewed · {triage.reviewedCount} of {triage.totalCount}
              </span>
              <span className="font-mono text-muted-foreground">{dispoBreakdown.reviewedPct}%</span>
            </div>
            {/* Segmented progress: confirmed | modified | rejected | pending */}
            <div
              className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={dispoBreakdown.reviewedPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${dispoBreakdown.confirmed} confirmed, ${dispoBreakdown.modified} modified, ${dispoBreakdown.rejected} rejected`}
            >
              {dispoBreakdown.confirmedPct > 0 && (
                <div className="h-full bg-success transition-all" style={{ width: `${dispoBreakdown.confirmedPct}%` }} />
              )}
              {dispoBreakdown.modifiedPct > 0 && (
                <div className="h-full bg-warning transition-all" style={{ width: `${dispoBreakdown.modifiedPct}%` }} />
              )}
              {dispoBreakdown.rejectedPct > 0 && (
                <div className="h-full bg-destructive transition-all" style={{ width: `${dispoBreakdown.rejectedPct}%` }} />
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs text-muted-foreground">
              <DispoLegend swatch="bg-success" label="Confirmed" count={dispoBreakdown.confirmed} />
              <DispoLegend swatch="bg-warning" label="Modified" count={dispoBreakdown.modified} />
              <DispoLegend swatch="bg-destructive" label="Rejected" count={dispoBreakdown.rejected} />
              <DispoLegend swatch="bg-muted-foreground/40" label="Pending" count={dispoBreakdown.pending} />
            </div>
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
