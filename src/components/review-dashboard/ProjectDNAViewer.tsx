import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Pencil,
  Check,
  X,
  Loader2,
  Play,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  useProjectDna,
  updateProjectDna,
  type ProjectDnaRow,
} from "@/hooks/useReviewDashboard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Props {
  planReviewId: string;
  jurisdictionMismatch?: boolean;
  /** When true, re-extracted/edited DNA will trigger a partial pipeline re-run from `verify`. */
  onAfterRerun?: () => void;
}

interface FieldDef {
  key: keyof ProjectDnaRow;
  label: string;
  type: "text" | "number" | "boolean";
}

const FIELDS: FieldDef[] = [
  { key: "occupancy_classification", label: "Occupancy Classification", type: "text" },
  { key: "construction_type", label: "Construction Type", type: "text" },
  { key: "total_sq_ft", label: "Total Sq Ft", type: "number" },
  { key: "stories", label: "Stories", type: "number" },
  { key: "fbc_edition", label: "FBC Edition", type: "text" },
  { key: "jurisdiction", label: "Jurisdiction", type: "text" },
  { key: "county", label: "County", type: "text" },
  { key: "hvhz", label: "HVHZ", type: "boolean" },
  { key: "flood_zone", label: "Flood Zone", type: "text" },
  { key: "wind_speed_vult", label: "Wind Speed (Vult)", type: "number" },
  { key: "exposure_category", label: "Exposure Category", type: "text" },
  { key: "risk_category", label: "Risk Category", type: "text" },
  { key: "seismic_design_category", label: "Seismic Design Category", type: "text" },
  { key: "has_mezzanine", label: "Has Mezzanine", type: "boolean" },
  { key: "is_high_rise", label: "High Rise", type: "boolean" },
  { key: "mixed_occupancy", label: "Mixed Occupancy", type: "boolean" },
];

export default function ProjectDNAViewer({
  planReviewId,
  jurisdictionMismatch,
  onAfterRerun,
}: Props) {
  const { data: dna } = useProjectDna(planReviewId);
  const qc = useQueryClient();
  const [open, setOpen] = useState(true);

  // Pending edits — buffered locally; only persisted when reviewer hits "Save & Re-run".
  const [drafts, setDrafts] = useState<Partial<Record<string, string | boolean | null>>>({});
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  // Reset local drafts when DNA changes server-side (e.g. after re-extract).
  useEffect(() => {
    setDrafts({});
    setEditing({});
  }, [dna?.updated_at]);

  const missingSet = useMemo(
    () => new Set(dna?.missing_fields ?? []),
    [dna?.missing_fields],
  );
  const ambiguousSet = useMemo(
    () => new Set(dna?.ambiguous_fields ?? []),
    [dna?.ambiguous_fields],
  );

  const dirtyKeys = Object.keys(drafts);
  const hasDirty = dirtyKeys.length > 0;

  if (!dna) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        Project DNA not yet extracted.
      </div>
    );
  }

  const startEdit = (key: string) => {
    setEditing((e) => ({ ...e, [key]: true }));
  };

  const cancelEdit = (key: string) => {
    setEditing((e) => ({ ...e, [key]: false }));
    setDrafts((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });
  };

  const setDraft = (key: string, value: string | boolean | null) => {
    setDrafts((d) => ({ ...d, [key]: value }));
  };

  const commitEdit = (key: string) => {
    // Just close the editor — the value stays in `drafts` until Save & Re-run.
    setEditing((e) => ({ ...e, [key]: false }));
  };

  const handleSaveAndRerun = async () => {
    if (!hasDirty) return;
    setSaving(true);
    try {
      // Coerce drafts to typed values per field.
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(drafts)) {
        const def = FIELDS.find((f) => f.key === k);
        if (!def) continue;
        if (v === null || v === "") {
          patch[k] = null;
        } else if (def.type === "number") {
          const n = typeof v === "number" ? v : Number(v);
          patch[k] = Number.isFinite(n) ? n : null;
        } else if (def.type === "boolean") {
          patch[k] = typeof v === "boolean" ? v : v === "true";
        } else {
          patch[k] = String(v);
        }
      }

      await updateProjectDna(planReviewId, patch as Partial<ProjectDnaRow>);

      // Provenance: log the manual override.
      const { data: userData } = await supabase.auth.getUser();
      const projectId = await getProjectIdForReview(planReviewId);
      await supabase.from("activity_log").insert({
        event_type: "dna_manual_override",
        description: `Reviewer patched ${dirtyKeys.length} Project DNA field${
          dirtyKeys.length === 1 ? "" : "s"
        }: ${dirtyKeys.join(", ")}`,
        project_id: projectId,
        actor_id: userData?.user?.id ?? null,
        actor_type: "user",
        metadata: { plan_review_id: planReviewId, fields: patch },
      });

      toast.success("DNA patched — re-running pipeline from verification…");
      qc.invalidateQueries({ queryKey: ["project_dna", planReviewId] });

      // Re-run pipeline starting at verify (skip extract) so the gate re-evaluates.
      const { error } = await supabase.functions.invoke("run-review-pipeline", {
        body: { plan_review_id: planReviewId, start_from: "dna_extract" },
      });
      if (error) throw error;

      toast.success("Pipeline re-run complete");
      qc.invalidateQueries({ queryKey: ["pipeline_status", planReviewId] });
      qc.invalidateQueries({ queryKey: ["deficiencies_v2", planReviewId] });
      qc.invalidateQueries({ queryKey: ["sheet_coverage", planReviewId] });
      qc.invalidateQueries({ queryKey: ["project_dna", planReviewId] });
      setDrafts({});
      setEditing({});
      onAfterRerun?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save DNA";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex w-full items-center justify-between p-4">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex flex-1 items-center gap-2 text-left"
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <span className="text-sm font-semibold">Project DNA</span>
          {missingSet.size > 0 && (
            <span className="inline-flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-2xs font-medium text-destructive">
              <AlertTriangle className="h-3 w-3" />
              {missingSet.size} missing
            </span>
          )}
          {ambiguousSet.size > 0 && (
            <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-2xs font-medium text-amber-700 dark:text-amber-400">
              {ambiguousSet.size} ambiguous
            </span>
          )}
          {jurisdictionMismatch && (
            <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-2xs font-medium text-destructive">
              Jurisdiction mismatch
            </span>
          )}
        </button>
        {hasDirty && (
          <Button
            type="button"
            size="sm"
            onClick={handleSaveAndRerun}
            disabled={saving}
            className="ml-2 h-8"
          >
            {saving ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="mr-1 h-3.5 w-3.5" />
            )}
            Save {dirtyKeys.length} & Re-run
          </Button>
        )}
      </div>

      {open && (
        <div className="border-t">
          <table className="w-full text-xs">
            <tbody>
              {FIELDS.map((def) => {
                const k = def.key as string;
                const serverVal = (dna as unknown as Record<string, unknown>)[k];
                const draftVal = drafts[k];
                const hasDraft = k in drafts;
                const isMissing =
                  missingSet.has(k) || serverVal === null || serverVal === undefined || serverVal === "";
                const isAmbiguous = ambiguousSet.has(k);
                const isEditing = !!editing[k];
                const displayVal = hasDraft ? draftVal : serverVal;

                return (
                  <tr key={k} className="border-b last:border-b-0">
                    <td className="w-1/2 px-4 py-2 font-medium text-muted-foreground">
                      {def.label}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-2",
                        !isEditing &&
                          !hasDraft &&
                          isMissing &&
                          "bg-destructive/5 font-medium text-destructive",
                        !isEditing &&
                          !hasDraft &&
                          !isMissing &&
                          isAmbiguous &&
                          "bg-amber-500/5 text-amber-700 dark:text-amber-400",
                        hasDraft && "bg-primary/5 text-primary font-medium",
                      )}
                    >
                      {isEditing ? (
                        <FieldEditor
                          def={def}
                          value={displayVal}
                          onChange={(v) => setDraft(k, v)}
                          onCommit={() => commitEdit(k)}
                          onCancel={() => cancelEdit(k)}
                        />
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <span>
                            {hasDraft && (
                              <span className="mr-1 font-mono text-2xs uppercase opacity-60">
                                edited →
                              </span>
                            )}
                            {isMissing && !hasDraft ? "MISSING" : formatValue(displayVal)}
                          </span>
                          <button
                            type="button"
                            onClick={() => startEdit(k)}
                            className="opacity-40 transition-opacity hover:opacity-100"
                            aria-label={`Edit ${def.label}`}
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FieldEditor({
  def,
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  def: FieldDef;
  value: unknown;
  onChange: (v: string | boolean | null) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  if (def.type === "boolean") {
    const v = value === true || value === "true";
    return (
      <div className="flex items-center gap-2">
        <select
          value={v ? "true" : value === false ? "false" : ""}
          onChange={(e) =>
            onChange(e.target.value === "" ? null : e.target.value === "true")
          }
          className="h-7 rounded border border-input bg-background px-2 text-xs"
          autoFocus
        >
          <option value="">—</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
        <EditorButtons onCommit={onCommit} onCancel={onCancel} />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Input
        type={def.type === "number" ? "number" : "text"}
        value={value === null || value === undefined ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit();
          if (e.key === "Escape") onCancel();
        }}
        className="h-7 text-xs"
        autoFocus
      />
      <EditorButtons onCommit={onCommit} onCancel={onCancel} />
    </div>
  );
}

function EditorButtons({
  onCommit,
  onCancel,
}: {
  onCommit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex shrink-0 gap-1">
      <button
        type="button"
        onClick={onCommit}
        className="flex h-6 w-6 items-center justify-center rounded text-primary hover:bg-primary/10"
        aria-label="Apply"
      >
        <Check className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted"
        aria-label="Cancel"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function formatValue(v: unknown): string {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

async function getProjectIdForReview(planReviewId: string): Promise<string | null> {
  const { data } = await supabase
    .from("plan_reviews")
    .select("project_id")
    .eq("id", planReviewId)
    .maybeSingle();
  return (data?.project_id as string | undefined) ?? null;
}
