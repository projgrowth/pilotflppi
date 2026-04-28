/**
 * StatutoryCompliancePanel — surfaces the F.S. 553.791 prerequisites that
 * the reviewer must affirm before a comment letter can be sent, and the
 * F.S. 553.79(5) Threshold Building / Special Inspector designation when the
 * project's DNA triggers it.
 *
 *   1. Notice to Building Official has been filed with the AHJ for this round.
 *   2. Plan Compliance Affidavit has been signed for this round.
 *   3. (If threshold building) Special Inspector designated by the EOR.
 *
 * All three are mirrored as blocking checks in `letter-readiness.ts`.
 * This panel just gives the reviewer a one-click way to record them. The
 * underlying documents are generated from the Documents page.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  CheckCircle2,
  FileText,
  Undo2,
  ExternalLink,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  planReviewId: string;
  round: number;
  noticeFiledAt: string | null | undefined;
  affidavitSignedAt: string | null | undefined;
  isThresholdBuilding?: boolean;
  thresholdTriggers?: string[];
  specialInspectorDesignated?: boolean;
  specialInspectorName?: string | null;
  specialInspectorLicense?: string | null;
  onChanged?: () => void;
}

export default function StatutoryCompliancePanel({
  planReviewId,
  round,
  noticeFiledAt,
  affidavitSignedAt,
  isThresholdBuilding = false,
  thresholdTriggers = [],
  specialInspectorDesignated = false,
  specialInspectorName,
  specialInspectorLicense,
  onChanged,
}: Props) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [siName, setSiName] = useState(specialInspectorName ?? "");
  const [siLicense, setSiLicense] = useState(specialInspectorLicense ?? "");
  const [editingSi, setEditingSi] = useState(false);

  const update = useMutation({
    mutationFn: async (patch: {
      notice_to_building_official_filed_at?: string | null;
      compliance_affidavit_signed_at?: string | null;
      special_inspector_designated?: boolean;
      special_inspector_name?: string | null;
      special_inspector_license?: string | null;
    }) => {
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
  const thresholdSatisfied = !isThresholdBuilding || specialInspectorDesignated;
  const allGood = noticeFiled && affidavitSigned && thresholdSatisfied;

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

  const saveSpecialInspector = async () => {
    const name = siName.trim();
    const license = siLicense.trim();
    if (!name || !license) {
      toast.error("Special Inspector name and license are both required (F.S. 553.79(5)).");
      return;
    }
    setBusy("si");
    try {
      await update.mutateAsync({
        special_inspector_designated: true,
        special_inspector_name: name,
        special_inspector_license: license,
      });
      toast.success("Special Inspector recorded");
      setEditingSi(false);
    } finally {
      setBusy(null);
    }
  };

  const clearSpecialInspector = async () => {
    setBusy("si");
    try {
      await update.mutateAsync({
        special_inspector_designated: false,
        special_inspector_name: null,
        special_inspector_license: null,
      });
      setSiName("");
      setSiLicense("");
      setEditingSi(false);
      toast.success("Special Inspector cleared");
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

      {/* Threshold Building — F.S. 553.79(5) */}
      <div className="mt-3 border-t pt-3">
        {!isThresholdBuilding ? (
          <div className="flex items-center gap-2 text-2xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-success" />
            Not a threshold building (F.S. 553.79(5)) — Special Inspector not required.
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <ShieldAlert
                className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
                  specialInspectorDesignated ? "text-success" : "text-destructive"
                }`}
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium">
                  Threshold Building — F.S. 553.79(5) applies
                </div>
                {thresholdTriggers.length > 0 && (
                  <ul className="mt-0.5 list-disc pl-4 text-2xs text-muted-foreground">
                    {thresholdTriggers.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                )}
                <div className="mt-1 text-2xs text-muted-foreground">
                  EOR must designate a licensed Special Inspector and the
                  Statement of Special Inspections must appear on the structural
                  drawings (FBC-B 1704.6 / 1705).
                </div>
              </div>
            </div>

            {specialInspectorDesignated && !editingSi ? (
              <div className="flex items-center justify-between rounded-md border bg-card px-2.5 py-1.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-medium">
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                    Special Inspector recorded
                  </div>
                  <div className="mt-0.5 text-2xs text-muted-foreground">
                    {specialInspectorName} · License {specialInspectorLicense}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5 text-2xs"
                    onClick={() => setEditingSi(true)}
                    disabled={busy === "si"}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 gap-1 px-1.5 text-2xs"
                    onClick={clearSpecialInspector}
                    disabled={busy === "si"}
                  >
                    <Undo2 className="h-3 w-3" /> Clear
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid gap-2 rounded-md border bg-card p-2 sm:grid-cols-[1fr_180px_auto]">
                <div>
                  <Label className="text-2xs uppercase tracking-wide text-muted-foreground">
                    Special Inspector
                  </Label>
                  <Input
                    value={siName}
                    onChange={(e) => setSiName(e.target.value)}
                    placeholder="Full name"
                    className="h-8 text-xs"
                    maxLength={200}
                  />
                </div>
                <div>
                  <Label className="text-2xs uppercase tracking-wide text-muted-foreground">
                    FL License #
                  </Label>
                  <Input
                    value={siLicense}
                    onChange={(e) => setSiLicense(e.target.value)}
                    placeholder="PE / SI license"
                    className="h-8 text-xs"
                    maxLength={64}
                  />
                </div>
                <div className="flex items-end gap-1">
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    onClick={saveSpecialInspector}
                    disabled={busy === "si"}
                  >
                    Save
                  </Button>
                  {editingSi && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs"
                      onClick={() => {
                        setEditingSi(false);
                        setSiName(specialInspectorName ?? "");
                        setSiLicense(specialInspectorLicense ?? "");
                      }}
                      disabled={busy === "si"}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
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
