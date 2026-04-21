import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  GitMerge,
  X,
  ChevronDown,
  ChevronUp,
  History,
  Loader2,
  GitCompareArrows,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePipelineStatus } from "@/hooks/useReviewDashboard";

interface DuplicateGroup {
  key: string;
  fbc_section: string;
  sheet_ref: string;
  deficiency_ids: string[];
  def_numbers: string[];
}

interface Contradiction {
  deficiency_id: string;
  def_number: string;
  finding: string;
  prior_round: number;
  prior_status: string;
  prior_finding: string;
  reason: string;
}

interface ConsistencyMismatch {
  category: string;
  description: string;
  sheet_a: string;
  value_a: string;
  sheet_b: string;
  value_b: string;
  evidence: string[];
  severity: "high" | "medium" | "low";
  confidence_score: number;
  deficiency_id?: string;
  def_number?: string;
}

interface CrossCheckMetadata {
  duplicate_groups?: DuplicateGroup[];
  duplicates_found?: number;
  contradictions?: Contradiction[];
  contradictions_found?: number;
  consistency_mismatches?: ConsistencyMismatch[];
  consistency_mismatches_found?: number;
}

interface Props {
  planReviewId: string;
}

export default function CrossCheckBanner({ planReviewId }: Props) {
  const qc = useQueryClient();
  const { data: rows = [] } = usePipelineStatus(planReviewId);
  const [open, setOpen] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const meta = useMemo(() => {
    const row = rows.find((r) => r.stage === "cross_check");
    return ((row as unknown as { metadata?: CrossCheckMetadata } | undefined)?.metadata ??
      {}) as CrossCheckMetadata;
  }, [rows]);

  const duplicates = meta.duplicate_groups ?? [];
  const contradictions = meta.contradictions ?? [];
  const consistencyMismatches = meta.consistency_mismatches ?? [];
  const total = duplicates.length + contradictions.length + consistencyMismatches.length;

  if (total === 0) return null;

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["deficiencies_v2", planReviewId] });
    qc.invalidateQueries({ queryKey: ["pipeline_status", planReviewId] });
  };

  const mergeGroup = async (group: DuplicateGroup) => {
    setBusyId(group.key);
    try {
      const [canonicalId, ...dupIds] = group.deficiency_ids;
      const { data: all, error: fetchErr } = await supabase
        .from("deficiencies_v2")
        .select("id, sheet_refs")
        .in("id", group.deficiency_ids);
      if (fetchErr) throw fetchErr;

      const merged = new Set<string>();
      for (const row of (all ?? []) as Array<{ id: string; sheet_refs: string[] | null }>) {
        for (const s of row.sheet_refs ?? []) merged.add(s);
      }

      const { error: updErr } = await supabase
        .from("deficiencies_v2")
        .update({ sheet_refs: Array.from(merged) })
        .eq("id", canonicalId);
      if (updErr) throw updErr;

      const { error: dupErr } = await supabase
        .from("deficiencies_v2")
        .update({
          status: "resolved",
          reviewer_disposition: "modify",
          reviewer_notes: `Merged into ${group.def_numbers[0]} (duplicate FBC ${group.fbc_section} on ${group.sheet_ref}).`,
        })
        .in("id", dupIds);
      if (dupErr) throw dupErr;

      toast.success(`Merged ${dupIds.length} duplicate${dupIds.length > 1 ? "s" : ""} into ${group.def_numbers[0]}`);
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Merge failed");
    } finally {
      setBusyId(null);
    }
  };

  const dismissGroup = async (group: DuplicateGroup) => {
    setBusyId(group.key);
    try {
      await dismissKeys([group.key]);
      toast.success("Duplicate alert dismissed");
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Dismiss failed");
    } finally {
      setBusyId(null);
    }
  };

  const dismissContradiction = async (c: Contradiction) => {
    setBusyId(c.deficiency_id);
    try {
      await dismissKeys([`contradiction:${c.deficiency_id}`]);
      toast.success("Contradiction dismissed");
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Dismiss failed");
    } finally {
      setBusyId(null);
    }
  };

  const reopenContradiction = async (c: Contradiction) => {
    setBusyId(c.deficiency_id);
    try {
      const { error } = await supabase
        .from("deficiencies_v2")
        .update({
          requires_human_review: true,
          human_review_reason: c.reason,
          human_review_method:
            "Verify whether the issue was actually addressed in the prior round before re-issuing.",
        })
        .eq("id", c.deficiency_id);
      if (error) throw error;
      toast.success(`${c.def_number} flagged for human review`);
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  };

  const dismissConsistency = async (m: ConsistencyMismatch, idx: number) => {
    const key = `consistency:${m.deficiency_id ?? `${m.sheet_a}|${m.sheet_b}|${idx}`}`;
    setBusyId(key);
    try {
      await dismissKeys([key]);
      // If we created a deficiency, also resolve it so it disappears from the list.
      if (m.deficiency_id) {
        await supabase
          .from("deficiencies_v2")
          .update({
            status: "resolved",
            reviewer_disposition: "reject",
            reviewer_notes: "Cross-sheet mismatch dismissed from banner.",
          })
          .eq("id", m.deficiency_id);
      }
      toast.success("Mismatch dismissed");
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Dismiss failed");
    } finally {
      setBusyId(null);
    }
  };

  const dismissKeys = async (keys: string[]) => {
    const row = rows.find((r) => r.stage === "cross_check");
    const existing =
      ((row as unknown as { metadata?: CrossCheckMetadata } | undefined)?.metadata ??
        {}) as CrossCheckMetadata & { dismissed?: string[] };
    const dismissed = new Set([...(existing.dismissed ?? []), ...keys]);

    const filteredDuplicates = (existing.duplicate_groups ?? []).filter(
      (g) => !dismissed.has(g.key),
    );
    const filteredContradictions = (existing.contradictions ?? []).filter(
      (c) => !dismissed.has(`contradiction:${c.deficiency_id}`),
    );
    const filteredConsistency = (existing.consistency_mismatches ?? []).filter(
      (m, idx) =>
        !dismissed.has(
          `consistency:${m.deficiency_id ?? `${m.sheet_a}|${m.sheet_b}|${idx}`}`,
        ),
    );

    const nextMetadata = {
      ...existing,
      duplicate_groups: filteredDuplicates,
      duplicates_found: filteredDuplicates.length,
      contradictions: filteredContradictions,
      contradictions_found: filteredContradictions.length,
      consistency_mismatches: filteredConsistency,
      consistency_mismatches_found: filteredConsistency.length,
      dismissed: Array.from(dismissed),
    } as unknown as Record<string, never>;

    const { error } = await supabase
      .from("review_pipeline_status")
      .update({ metadata: nextMetadata })
      .eq("plan_review_id", planReviewId)
      .eq("stage", "cross_check");
    if (error) throw error;
  };

  return (
    <div
      className={cn(
        "rounded-lg border bg-amber-500/5 dark:bg-amber-500/10",
        "border-amber-500/40",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <span className="text-sm font-medium">
            Cross-check found {total} issue{total === 1 ? "" : "s"}
          </span>
          <span className="text-xs text-muted-foreground">
            {[
              duplicates.length > 0
                ? `${duplicates.length} duplicate${duplicates.length === 1 ? "" : "s"}`
                : null,
              contradictions.length > 0
                ? `${contradictions.length} contradiction${contradictions.length === 1 ? "" : "s"}`
                : null,
              consistencyMismatches.length > 0
                ? `${consistencyMismatches.length} cross-sheet mismatch${consistencyMismatches.length === 1 ? "" : "es"}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="space-y-3 border-t border-amber-500/30 px-4 py-3">
          {duplicates.length > 0 && (
            <div className="space-y-2">
              <div className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                Duplicate findings
              </div>
              {duplicates.map((g) => (
                <div
                  key={g.key}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background/60 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">
                      <span className="font-medium">FBC {g.fbc_section}</span>{" "}
                      <span className="text-muted-foreground">on {g.sheet_ref}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      Cited in: {g.def_numbers.join(", ")}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => mergeGroup(g)}
                      disabled={busyId === g.key}
                    >
                      {busyId === g.key ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <GitMerge className="h-3.5 w-3.5" />
                      )}
                      Merge into {g.def_numbers[0]}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => dismissGroup(g)}
                      disabled={busyId === g.key}
                    >
                      <X className="h-3.5 w-3.5" />
                      Dismiss
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {contradictions.length > 0 && (
            <div className="space-y-2">
              <div className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                Contradictions vs prior rounds
              </div>
              {contradictions.map((c) => (
                <div
                  key={c.deficiency_id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background/60 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{c.def_number}</div>
                    <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                      {c.finding}
                    </div>
                    <div className="mt-1 flex items-center gap-1 text-2xs text-amber-700 dark:text-amber-400">
                      <History className="h-3 w-3" />
                      Round {c.prior_round}: {c.prior_status} — {c.prior_finding.slice(0, 80)}
                      {c.prior_finding.length > 80 ? "…" : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => reopenContradiction(c)}
                      disabled={busyId === c.deficiency_id}
                    >
                      {busyId === c.deficiency_id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5" />
                      )}
                      Flag for review
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => dismissContradiction(c)}
                      disabled={busyId === c.deficiency_id}
                    >
                      <X className="h-3.5 w-3.5" />
                      Dismiss
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {consistencyMismatches.length > 0 && (
            <div className="space-y-2">
              <div className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                Cross-sheet mismatches
              </div>
              {consistencyMismatches.map((m, idx) => {
                const key = `consistency:${m.deficiency_id ?? `${m.sheet_a}|${m.sheet_b}|${idx}`}`;
                return (
                  <div
                    key={key}
                    className="rounded-md border border-border bg-background/60 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm">
                          <GitCompareArrows className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                          <span className="font-medium">
                            {m.def_number ?? "Mismatch"}
                          </span>
                          <span className="text-2xs uppercase tracking-wide text-muted-foreground">
                            {m.category.replace(/_/g, " ")}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {m.description}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-2xs">
                          <span className="rounded bg-muted px-1.5 py-0.5 font-mono">
                            {m.sheet_a}
                          </span>
                          <span className="text-muted-foreground">"{m.value_a}"</span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          <span className="rounded bg-muted px-1.5 py-0.5 font-mono">
                            {m.sheet_b}
                          </span>
                          <span className="text-muted-foreground">"{m.value_b}"</span>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => dismissConsistency(m, idx)}
                        disabled={busyId === key}
                      >
                        {busyId === key ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <X className="h-3.5 w-3.5" />
                        )}
                        Dismiss
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
