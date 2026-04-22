import { useState } from "react";
import { Check, X, Pencil } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import {
  type DeficiencyV2Row,
  updateDeficiencyDisposition,
  useOptimisticDisposition,
} from "@/hooks/useReviewDashboard";
import RejectionReasonDialog from "../RejectionReasonDialog";
import {
  recordCorrectionPattern,
  type RejectionReason,
} from "@/hooks/useCorrectionPatterns";

interface Props {
  planReviewId: string;
  def: DeficiencyV2Row;
}

export default function DeficiencyActions({ planReviewId, def }: Props) {
  const qc = useQueryClient();
  const optimisticUpdate = useOptimisticDisposition(planReviewId);
  const [notes, setNotes] = useState(def.reviewer_notes ?? "");
  const [saving, setSaving] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);

  async function setDisposition(d: "confirm" | "reject" | "modify") {
    if (d === "reject") {
      setRejectOpen(true);
      return;
    }
    setSaving(d);
    try {
      // Optimistic — cache patches immediately, realtime echo reconciles.
      await optimisticUpdate(def.id, { reviewer_disposition: d });
      toast.success(`Marked ${d}`);
    } catch {
      toast.error("Could not save");
    } finally {
      setSaving(null);
    }
  }

  async function handleRejectConfirm(reason: RejectionReason, reasonNotes: string) {
    setSaving("reject");
    try {
      await updateDeficiencyDisposition(def.id, {
        reviewer_disposition: "reject",
        status: "waived",
      });

      const { data: auth } = await supabase.auth.getUser();
      await supabase.from("review_feedback").insert({
        plan_review_id: planReviewId,
        deficiency_id: def.id,
        feedback_type: `reject_${reason}`,
        notes: reasonNotes || null,
        reviewer_id: auth?.user?.id ?? null,
      });

      await recordCorrectionPattern({
        planReviewId,
        deficiency: {
          id: def.id,
          discipline: def.discipline,
          finding: def.finding,
          required_action: def.required_action,
          code_reference: def.code_reference,
        },
        reason,
        notes: reasonNotes,
      });

      qc.invalidateQueries({ queryKey: ["deficiencies_v2", planReviewId] });
      qc.invalidateQueries({ queryKey: ["correction_patterns"] });
      setRejectOpen(false);
      toast.success("Rejected — pattern saved for future reviews");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save rejection");
    } finally {
      setSaving(null);
    }
  }

  async function setStatus(s: DeficiencyV2Row["status"]) {
    try {
      await optimisticUpdate(def.id, { status: s });
    } catch {
      toast.error("Could not update status");
    }
  }

  async function saveNotes() {
    try {
      await updateDeficiencyDisposition(def.id, { reviewer_notes: notes });
      toast.success("Notes saved");
    } catch {
      toast.error("Could not save notes");
    }
  }

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
        <DispositionButton
          label="Confirm"
          icon={<Check className="h-3.5 w-3.5" />}
          active={def.reviewer_disposition === "confirm"}
          loading={saving === "confirm"}
          onClick={() => setDisposition("confirm")}
        />
        <DispositionButton
          label="Reject"
          icon={<X className="h-3.5 w-3.5" />}
          active={def.reviewer_disposition === "reject"}
          loading={saving === "reject"}
          onClick={() => setDisposition("reject")}
          tone="destructive"
        />
        <DispositionButton
          label="Modify"
          icon={<Pencil className="h-3.5 w-3.5" />}
          active={def.reviewer_disposition === "modify"}
          loading={saving === "modify"}
          onClick={() => setDisposition("modify")}
        />
        <div className="ml-auto">
          <Select value={def.status} onValueChange={(v) => setStatus(v as DeficiencyV2Row["status"])}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="waived">Waived</SelectItem>
              <SelectItem value="needs_info">Needs Info</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-2">
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveNotes}
          placeholder="Reviewer notes…"
          className="min-h-[60px] text-xs"
        />
      </div>

      <RejectionReasonDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        defNumber={def.def_number}
        finding={def.finding}
        saving={saving === "reject"}
        onConfirm={handleRejectConfirm}
      />
    </>
  );
}

function DispositionButton({
  label,
  icon,
  active,
  loading,
  onClick,
  tone,
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  loading?: boolean;
  onClick: () => void;
  tone?: "destructive";
}) {
  return (
    <Button
      type="button"
      variant={active ? (tone === "destructive" ? "destructive" : "default") : "outline"}
      size="sm"
      className="h-8 gap-1 text-xs"
      onClick={onClick}
      disabled={loading}
    >
      {icon}
      {label}
    </Button>
  );
}
