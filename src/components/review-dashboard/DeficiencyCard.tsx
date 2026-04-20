import { useState } from "react";
import { Check, X, Pencil, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import {
  type DeficiencyV2Row,
  updateDeficiencyDisposition,
} from "@/hooks/useReviewDashboard";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface Props {
  planReviewId: string;
  def: DeficiencyV2Row;
  showHumanReviewContext?: boolean;
}

export default function DeficiencyCard({ planReviewId, def, showHumanReviewContext }: Props) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState(def.reviewer_notes ?? "");
  const [saving, setSaving] = useState<string | null>(null);

  async function setDisposition(d: "confirm" | "reject" | "modify") {
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

  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-4 shadow-sm",
        def.life_safety_flag && "border-destructive/40",
        def.requires_human_review && "ring-1 ring-accent/40",
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
        {def.sheet_refs.length > 0 && (
          <span className="text-muted-foreground">
            Sheet{def.sheet_refs.length > 1 ? "s" : ""}: {def.sheet_refs.join(", ")}
          </span>
        )}
        <span className="text-muted-foreground">· {def.discipline}</span>
        <div className="ml-auto flex flex-wrap gap-1">
          {def.life_safety_flag && <Tag tone="critical">LIFE SAFETY</Tag>}
          {def.permit_blocker && <Tag tone="warn">PERMIT BLOCKER</Tag>}
          {def.liability_flag && <Tag tone="caution">LIABILITY</Tag>}
          {def.requires_human_review && <Tag tone="accent">HUMAN REVIEW</Tag>}
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

        {showHumanReviewContext && def.requires_human_review && (
          <div className="rounded-md border border-accent/30 bg-accent/5 p-3 text-xs space-y-1">
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

        {typeof def.confidence_score === "number" && (
          <div className="flex items-center gap-2 text-2xs text-muted-foreground">
            <span>Confidence: {Math.round(def.confidence_score * 100)}%</span>
            {def.confidence_basis && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center text-muted-foreground hover:text-foreground"
                  >
                    <Info className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  {def.confidence_basis}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
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
    </div>
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
