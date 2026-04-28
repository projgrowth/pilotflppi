/**
 * StatutoryCompliancePanel — surfaces the two F.S. 553.791 prerequisites
 * that the reviewer must affirm before a comment letter can be sent:
 *
 *   1. Notice to Building Official has been filed with the AHJ for this round.
 *   2. Plan Compliance Affidavit has been signed for this round.
 *
 * Both of these are also enforced as blocking checks in `letter-readiness.ts`.
 * This panel just gives the reviewer a one-click way to record that they
 * filed/signed them. The underlying documents are generated from the
 * Documents page (DocumentsGen.tsx).
 *
 * Compact by design — sits above the readiness gate. Does not replace the
 * full Documents page, just records the fact.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CheckCircle2, FileText, Undo2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  planReviewId: string;
  round: number;
  noticeFiledAt: string | null | undefined;
  affidavitSignedAt: string | null | undefined;
  onChanged?: () => void;
}

export default function StatutoryCompliancePanel({
  planReviewId,
  round,
  noticeFiledAt,
  affidavitSignedAt,
  onChanged,
}: Props) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const update = useMutation({
    mutationFn: async (patch: Record<string, string | null>) => {
      const { error } = await supabase
        .from("plan_reviews")
        .update(patch)
        .eq("id", planReviewId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plan_review_dashboard", planReviewId] });
      onChanged?.();
    },
    onError: (err: Error) => toast.error(err.message ?? "Update failed"),
  });

  const noticeFiled = !!noticeFiledAt;
  const affidavitSigned = !!affidavitSignedAt;
  const allGood = noticeFiled && affidavitSigned;

  const setNotice = async (filed: boolean) => {
    setBusy("notice");
    try {
      await update.mutateAsync({
        notice_to_building_official_filed_at: filed ? new Date().toISOString() : null,
      });
      toast.success(filed ? "Notice marked filed" : "Notice mark cleared");
    } finally {
      setBusy(null);
    }
  };

  const setAffidavit = async (signed: boolean) => {
    setBusy("affidavit");
    try {
      await update.mutateAsync({
        compliance_affidavit_signed_at: signed ? new Date().toISOString() : null,
      });
      toast.success(signed ? "Affidavit marked signed" : "Affidavit mark cleared");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className={`rounded-lg border p-3 ${
        allGood ? "border-success/30 bg-success/5" : "border-warning/40 bg-warning/5"
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <FileText className="h-4 w-4" />
          F.S. 553.791 — Round {round} prerequisites
        </div>
        <Button asChild variant="ghost" size="sm" className="h-7 gap-1 text-xs">
          <Link to="/documents-gen">
            Generate <ExternalLink className="h-3 w-3" />
          </Link>
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Row
          label="Notice to Building Official filed"
          satisfiedAt={noticeFiledAt}
          satisfied={noticeFiled}
          onMark={() => setNotice(true)}
          onClear={() => setNotice(false)}
          loading={busy === "notice"}
        />
        <Row
          label="Plan Compliance Affidavit signed"
          satisfiedAt={affidavitSignedAt}
          satisfied={affidavitSigned}
          onMark={() => setAffidavit(true)}
          onClear={() => setAffidavit(false)}
          loading={busy === "affidavit"}
        />
      </div>
    </div>
  );
}

function Row({
  label,
  satisfied,
  satisfiedAt,
  onMark,
  onClear,
  loading,
}: {
  label: string;
  satisfied: boolean;
  satisfiedAt: string | null | undefined;
  onMark: () => void;
  onClear: () => void;
  loading: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border bg-card px-2.5 py-1.5">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          {satisfied && <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
          {label}
        </div>
        {satisfied && satisfiedAt && (
          <div className="mt-0.5 text-2xs text-muted-foreground">
            {new Date(satisfiedAt).toLocaleString()}
          </div>
        )}
      </div>
      {satisfied ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 gap-1 px-1.5 text-2xs"
          onClick={onClear}
          disabled={loading}
        >
          <Undo2 className="h-3 w-3" /> Clear
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-2xs"
          onClick={onMark}
          disabled={loading}
        >
          Mark done
        </Button>
      )}
    </div>
  );
}
