import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Keyboard, CheckCheck, Loader2, Inbox } from "lucide-react";
import {
  useDeficienciesV2,
  updateDeficiencyDisposition,
  type DeficiencyV2Row,
} from "@/hooks/useReviewDashboard";
import { useTriageController } from "@/hooks/useTriageController";
import {
  sortByTriagePriority,
  groupBySheetForBulkConfirm,
} from "@/lib/triage-priority";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import DeficiencyCard from "./DeficiencyCard";
import TriageShortcutsOverlay from "./TriageShortcutsOverlay";
import RejectionReasonDialog from "./RejectionReasonDialog";
import { supabase } from "@/integrations/supabase/client";
import {
  recordCorrectionPattern,
  type RejectionReason,
} from "@/hooks/useCorrectionPatterns";

interface Props {
  planReviewId: string;
}

/**
 * Priority-sorted triage view. Default tab on the Review Dashboard so the
 * reviewer always lands on the most urgent finding instead of a flat list.
 *
 * Goals:
 *   - Surface "needs human eyes" + life-safety items at the top
 *   - One-keypress confirm/reject/modify with auto-advance
 *   - Per-sheet bulk-confirm for high-confidence routine batches
 */
export default function TriageInbox({ planReviewId }: Props) {
  const qc = useQueryClient();
  const { data: defs = [], isLoading } = useDeficienciesV2(planReviewId);
  const [rejectTarget, setRejectTarget] = useState<DeficiencyV2Row | null>(null);
  const [rejectSaving, setRejectSaving] = useState(false);
  const [bulkBusySheet, setBulkBusySheet] = useState<string | null>(null);

  // Hide superseded/overturned from the inbox — those belong in the audit tab.
  const liveDefs = useMemo(
    () =>
      defs.filter(
        (d) =>
          d.verification_status !== "superseded" &&
          d.verification_status !== "overturned",
      ),
    [defs],
  );

  const sortedItems = useMemo(() => sortByTriagePriority(liveDefs), [liveDefs]);

  const triage = useTriageController({
    planReviewId,
    items: sortedItems,
    enabled: !isLoading && sortedItems.length > 0,
    onRequestReject: (def) => setRejectTarget(def),
  });

  const sheetGroups = useMemo(() => {
    const unreviewed = sortedItems.filter((d) => d.reviewer_disposition === null);
    return groupBySheetForBulkConfirm(unreviewed).filter(
      (g) => g.eligibleForBulkConfirm,
    );
  }, [sortedItems]);

  const reviewedCount = triage.reviewedCount;
  const totalCount = triage.totalCount;
  const progressPct = totalCount > 0 ? Math.round((reviewedCount / totalCount) * 100) : 0;

  // Active card auto-advances; show the reviewer where they are in the queue.
  const activeIdx = useMemo(
    () => (triage.activeId ? sortedItems.findIndex((d) => d.id === triage.activeId) : -1),
    [sortedItems, triage.activeId],
  );

  async function handleBulkConfirm(sheet: string, items: DeficiencyV2Row[]) {
    setBulkBusySheet(sheet);
    try {
      await Promise.all(
        items.map((d) =>
          updateDeficiencyDisposition(d.id, { reviewer_disposition: "confirm" }),
        ),
      );
      qc.invalidateQueries({ queryKey: ["deficiencies_v2", planReviewId] });
      toast.success(`Confirmed ${items.length} on ${sheet}`);
    } catch {
      toast.error("Bulk confirm failed");
    } finally {
      setBulkBusySheet(null);
    }
  }

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
        Loading triage queue…
      </div>
    );
  }

  if (sortedItems.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border bg-card p-12 text-center">
        <Inbox className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm font-medium">Triage inbox is clear</p>
        <p className="text-xs text-muted-foreground">
          No live findings to triage. Check the Deficiencies tab for the full ledger.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Triage progress + active position + shortcuts */}
      <div className="rounded-md border bg-card p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1">
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-medium">
                Triage queue · {reviewedCount} of {totalCount} reviewed
                {activeIdx >= 0 && (
                  <span className="ml-2 text-muted-foreground">
                    · viewing #{activeIdx + 1}
                  </span>
                )}
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
        <p className="mt-2 text-2xs text-muted-foreground">
          Sorted by urgency — needs-human-review first, then life-safety, permit
          blockers, liability, low-confidence. Press{" "}
          <kbd className="rounded border bg-background px-1 font-mono">J</kbd>/
          <kbd className="rounded border bg-background px-1 font-mono">K</kbd> to
          move,{" "}
          <kbd className="rounded border bg-background px-1 font-mono">C</kbd>{" "}
          confirm,{" "}
          <kbd className="rounded border bg-background px-1 font-mono">R</kbd>{" "}
          reject,{" "}
          <kbd className="rounded border bg-background px-1 font-mono">M</kbd>{" "}
          modify.
        </p>
      </div>

      {/* Bulk-confirm strip — only renders when at least one sheet is eligible */}
      {sheetGroups.length > 0 && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
          <div className="mb-2 flex items-center gap-2">
            <CheckCheck className="h-4 w-4 text-primary" />
            <span className="text-xs font-medium">
              Bulk confirm — high-confidence sheets ready in one click
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {sheetGroups.map((g) => (
              <Button
                key={g.sheet}
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs"
                onClick={() => handleBulkConfirm(g.sheet, g.items)}
                disabled={bulkBusySheet === g.sheet}
              >
                {bulkBusySheet === g.sheet ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <CheckCheck className="h-3 w-3" />
                )}
                Confirm all {g.items.length} on{" "}
                <Badge variant="secondary" className="font-mono text-2xs">
                  {g.sheet}
                </Badge>
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Priority-sorted card list — flat, not grouped, so J/K matches reading order */}
      <div className="space-y-3">
        {sortedItems.map((d) => (
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
