import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Check,
  X,
  Pencil,
  Info,
  ChevronDown,
  ExternalLink,
  ShieldCheck,
  ShieldX,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  type DeficiencyV2Row,
  updateDeficiencyDisposition,
  useSheetCoverage,
} from "@/hooks/useReviewDashboard";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import RejectionReasonDialog from "./RejectionReasonDialog";
import {
  recordCorrectionPattern,
  type RejectionReason,
} from "@/hooks/useCorrectionPatterns";

interface Props {
  planReviewId: string;
  def: DeficiencyV2Row;
  showHumanReviewContext?: boolean;
}

export default function DeficiencyCard({ planReviewId, def, showHumanReviewContext }: Props) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState(def.reviewer_notes ?? "");
  const [saving, setSaving] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const { data: coverage = [] } = useSheetCoverage(planReviewId);

  // Map first cited sheet → page index for the "Open in PDF" deep link.
  const pageJump = useMemo(() => {
    const firstSheet = (def.sheet_refs ?? [])[0]?.toUpperCase();
    if (!firstSheet) return null;
    const hit = coverage.find(
      (c) => c.sheet_ref.toUpperCase() === firstSheet && c.page_index !== null,
    );
    return hit
      ? { sheet: firstSheet, page: hit.page_index! }
      : { sheet: firstSheet, page: null };
  }, [coverage, def.sheet_refs]);

  // Default open evidence panel for low-confidence findings.
  const defaultEvidenceOpen =
    typeof def.confidence_score === "number" && def.confidence_score < 0.7;
  const [evidenceOpen, setEvidenceOpen] = useState(defaultEvidenceOpen);

  async function setDisposition(d: "confirm" | "reject" | "modify") {
    // Reject opens the structured-reason dialog; the actual write happens in handleRejectConfirm.
    if (d === "reject") {
      setRejectOpen(true);
      return;
    }
    setSaving(d);
    try {
      await updateDeficiencyDisposition(def.id, { reviewer_disposition: d });
      qc.invalidateQueries({ queryKey: ["deficiencies_v2", planReviewId] });
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

      // Convert the rejection into a learned pattern.
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
      await updateDeficiencyDisposition(def.id, { status: s });
      qc.invalidateQueries({ queryKey: ["deficiencies_v2", planReviewId] });
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

  const codeRef = def.code_reference;
  const codeRefStr = codeRef
    ? [codeRef.code, codeRef.section, codeRef.edition && `(${codeRef.edition})`]
        .filter(Boolean)
        .join(" ")
    : null;

  const evidence = (def.evidence ?? []).filter(Boolean);
  const isOverturned = def.verification_status === "overturned";
  const isModified = def.verification_status === "modified";
  const isVerified = def.verification_status === "verified";

  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-4 shadow-sm",
        def.life_safety_flag && "border-destructive/40",
        def.requires_human_review && "border-l-4 border-l-amber-500",
        isOverturned && "opacity-60",
      )}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 text-2xs">
        <span
          className={cn(
            "rounded-md border px-2 py-0.5 font-mono font-semibold",
            priorityCls(def.priority),
          )}
        >
          {def.def_number}
        </span>
        <span className="text-muted-foreground">{def.discipline}</span>
        {typeof def.confidence_score === "number" && (
          <span className="font-mono text-muted-foreground">
            · conf {def.confidence_score.toFixed(2)}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <VerificationBadge status={def.verification_status} notes={def.verification_notes} />
          {def.life_safety_flag && <Tag tone="critical">LIFE SAFETY</Tag>}
          {def.permit_blocker && <Tag tone="warn">PERMIT BLOCKER</Tag>}
          {def.liability_flag && <Tag tone="caution">LIABILITY</Tag>}
          {def.requires_human_review && <Tag tone="accent">NEEDS HUMAN EYES</Tag>}
        </div>
      </div>

      {/* Body */}
      <div className="mt-3 space-y-2">
        {codeRefStr && (
          <div className="text-2xs font-mono text-muted-foreground">{codeRefStr}</div>
        )}
        <div>
          <div className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
            Finding
          </div>
          <div className="text-sm">{def.finding}</div>
        </div>
        <div>
          <div className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
            Required Action
          </div>
          <div className="text-sm">{def.required_action}</div>
        </div>

        {/* Sheet chips + open-in-PDF */}
        {def.sheet_refs.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
              Sheets:
            </span>
            {def.sheet_refs.map((s) => (
              <Badge key={s} variant="secondary" className="font-mono text-2xs">
                {s}
              </Badge>
            ))}
            {pageJump && (
              <Button
                asChild
                size="sm"
                variant="outline"
                className="ml-1 h-6 gap-1 px-2 text-2xs"
              >
                <Link
                  to={
                    pageJump.page !== null
                      ? `/plan-review/${planReviewId}?page=${pageJump.page}`
                      : `/plan-review/${planReviewId}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-3 w-3" />
                  Open {pageJump.sheet}
                </Link>
              </Button>
            )}
          </div>
        )}

        {showHumanReviewContext && def.requires_human_review && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs space-y-1">
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

        {/* Evidence-first collapsible — what the AI actually saw */}
        {(evidence.length > 0 || def.confidence_basis) && (
          <Collapsible open={evidenceOpen} onOpenChange={setEvidenceOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 rounded-md border border-dashed border-border px-3 py-2 text-2xs hover:bg-muted/40"
              >
                <span className="flex items-center gap-1.5 font-medium uppercase tracking-wide text-muted-foreground">
                  <Info className="h-3 w-3" />
                  Why the AI flagged this
                  {evidence.length > 0 && (
                    <span className="font-mono">
                      · {evidence.length} snippet{evidence.length === 1 ? "" : "s"}
                    </span>
                  )}
                </span>
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 text-muted-foreground transition-transform",
                    evidenceOpen && "rotate-180",
                  )}
                />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 pt-2">
              {evidence.length > 0 && (
                <ul className="space-y-1 border-l-2 border-primary/40 pl-3">
                  {evidence.map((e, i) => (
                    <li
                      key={i}
                      className="font-mono text-xs leading-relaxed text-muted-foreground"
                    >
                      "{e}"
                    </li>
                  ))}
                </ul>
              )}
              {def.confidence_basis && (
                <div className="rounded-md bg-muted/40 p-2 text-xs">
                  <span className="font-medium text-foreground">Confidence basis: </span>
                  <span className="text-muted-foreground">{def.confidence_basis}</span>
                </div>
              )}
              {(isOverturned || isModified || isVerified) && def.verification_notes && (
                <div
                  className={cn(
                    "rounded-md p-2 text-xs",
                    isOverturned && "bg-destructive/5 text-destructive",
                    isModified && "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                    isVerified && "bg-emerald-500/5 text-emerald-700 dark:text-emerald-300",
                  )}
                >
                  <span className="font-medium">Verification: </span>
                  {def.verification_notes}
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>

      {/* Footer */}
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
    </div>
  );
}

function VerificationBadge({
  status,
  notes,
}: {
  status: DeficiencyV2Row["verification_status"];
  notes: string | null;
}) {
  if (status === "unverified") return null;
  const cfg =
    status === "verified"
      ? {
          icon: <ShieldCheck className="h-3 w-3" />,
          label: "VERIFIED",
          cls: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400",
        }
      : status === "overturned"
        ? {
            icon: <ShieldX className="h-3 w-3" />,
            label: "OVERTURNED",
            cls: "bg-destructive/10 text-destructive border-destructive/30",
          }
        : {
            icon: <ShieldAlert className="h-3 w-3" />,
            label: "MODIFIED",
            cls: "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400",
          };
  const badge = (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        cfg.cls,
      )}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
  if (!notes) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{notes}</TooltipContent>
    </Tooltip>
  );
}

function priorityCls(p: "high" | "medium" | "low") {
  if (p === "high") return "bg-destructive/10 text-destructive border-destructive/30";
  if (p === "medium") return "bg-orange-500/10 text-orange-600 border-orange-500/30 dark:text-orange-400";
  return "bg-muted text-muted-foreground border-border";
}

function Tag({
  tone,
  children,
}: {
  tone: "critical" | "warn" | "caution" | "accent";
  children: React.ReactNode;
}) {
  const cls =
    tone === "critical"
      ? "bg-destructive text-destructive-foreground"
      : tone === "warn"
        ? "bg-orange-500 text-white"
        : tone === "caution"
          ? "bg-amber-500 text-white"
          : "bg-accent text-accent-foreground";
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${cls}`}
    >
      {children}
    </span>
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
