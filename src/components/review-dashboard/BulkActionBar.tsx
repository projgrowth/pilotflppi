import { Check, X, Loader2 } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { type DeficiencyV2Row } from "@/hooks/useReviewDashboard";
import { recordCorrectionPattern, type RejectionReason } from "@/hooks/useCorrectionPatterns";

interface Props {
  planReviewId: string;
  selected: DeficiencyV2Row[];
  onClear: () => void;
}

const REJECTION_REASONS: { value: RejectionReason; label: string }[] = [
  { value: "not_applicable", label: "Not applicable" },
  { value: "false_positive", label: "False positive" },
  { value: "duplicate", label: "Duplicate" },
  { value: "out_of_scope", label: "Out of scope" },
  { value: "code_misread", label: "Code misread" },
];

export default function BulkActionBar({ planReviewId, selected, onClear }: Props) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<"confirm" | "reject" | null>(null);
  const [reason, setReason] = useState<RejectionReason>("false_positive");

  if (selected.length === 0) return null;

  async function confirmAll() {
    setBusy("confirm");
    try {
      const ids = selected.map((d) => d.id);
      const { error } = await supabase
        .from("deficiencies_v2")
        .update({ reviewer_disposition: "confirm" })
        .in("id", ids);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["deficiencies_v2", planReviewId] });
      toast.success(`Confirmed ${ids.length} finding${ids.length === 1 ? "" : "s"}`);
      onClear();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk confirm failed");
    } finally {
      setBusy(null);
    }
  }

  async function rejectAll() {
    setBusy("reject");
    try {
      const ids = selected.map((d) => d.id);
      const { error } = await supabase
        .from("deficiencies_v2")
        .update({ reviewer_disposition: "reject", status: "waived" })
        .in("id", ids);
      if (error) throw error;

      const { data: auth } = await supabase.auth.getUser();
      const feedbackRows = selected.map((d) => ({
        plan_review_id: planReviewId,
        deficiency_id: d.id,
        feedback_type: `reject_${reason}`,
        notes: "Bulk reject",
        reviewer_id: auth?.user?.id ?? null,
      }));
      await supabase.from("review_feedback").insert(feedbackRows);

      // Record correction patterns sequentially (low volume; usually <10 per bulk).
      for (const d of selected) {
        try {
          await recordCorrectionPattern({
            planReviewId,
            deficiency: {
              id: d.id,
              discipline: d.discipline,
              finding: d.finding,
              required_action: d.required_action,
              code_reference: d.code_reference,
            },
            reason,
            notes: "Bulk reject",
          });
        } catch {
          // Pattern recording is best-effort; don't break the bulk action.
        }
      }

      qc.invalidateQueries({ queryKey: ["deficiencies_v2", planReviewId] });
      qc.invalidateQueries({ queryKey: ["correction_patterns"] });
      toast.success(`Rejected ${ids.length} — patterns saved`);
      onClear();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk reject failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="sticky top-2 z-30 flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 shadow-sm backdrop-blur">
      <span className="text-xs font-medium">
        {selected.length} selected
      </span>
      <Button
        size="sm"
        variant="default"
        className="h-7 gap-1 text-xs"
        onClick={confirmAll}
        disabled={!!busy}
      >
        {busy === "confirm" ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Check className="h-3 w-3" />
        )}
        Confirm all
      </Button>
      <div className="flex items-center gap-1">
        <Select value={reason} onValueChange={(v) => setReason(v as RejectionReason)}>
          <SelectTrigger className="h-7 w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REJECTION_REASONS.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="destructive"
          className="h-7 gap-1 text-xs"
          onClick={rejectAll}
          disabled={!!busy}
        >
          {busy === "reject" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <X className="h-3 w-3" />
          )}
          Reject all
        </Button>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="ml-auto h-7 text-xs"
        onClick={onClear}
      >
        Clear
      </Button>
    </div>
  );
}
