import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ClipboardList, ShieldAlert, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { deriveRequiredInspections } from "@/lib/required-inspections";
import { detectThresholdBuilding } from "@/lib/threshold-building";

interface Props {
  projectId: string;
  tradeType: string | null;
}

interface RequiredInspectionRow {
  id: string;
  inspection_type: string;
  code_basis: string;
  is_threshold_inspection: boolean;
  status: string;
  trade: string;
  result: string | null;
  scheduled_for: string | null;
  completed_at: string | null;
  sort_order: number;
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  not_started: { label: "Not Started", className: "bg-muted text-muted-foreground" },
  scheduled: { label: "Scheduled", className: "bg-teal/10 text-teal border-teal/20" },
  in_progress: { label: "In Progress", className: "bg-warning/10 text-warning border-warning/20" },
  passed: { label: "Passed", className: "bg-success/10 text-success border-success/20" },
  failed: { label: "Failed", className: "bg-destructive/10 text-destructive border-destructive/20" },
  partial: { label: "Partial", className: "bg-warning/10 text-warning border-warning/20" },
  na: { label: "N/A", className: "bg-muted text-muted-foreground" },
  waived: { label: "Waived", className: "bg-muted text-muted-foreground" },
};

export function RequiredInspectionsPanel({ projectId, tradeType }: Props) {
  const queryClient = useQueryClient();
  const [seeding, setSeeding] = useState(false);

  const { data: dnaRow } = useQuery({
    queryKey: ["project-dna-for-required", projectId],
    queryFn: async () => {
      const { data: reviews } = await supabase
        .from("plan_reviews")
        .select("id")
        .eq("project_id", projectId)
        .order("round", { ascending: false })
        .limit(1);
      const reviewId = reviews?.[0]?.id;
      if (!reviewId) return null;
      const { data } = await supabase
        .from("project_dna")
        .select("*")
        .eq("plan_review_id", reviewId)
        .maybeSingle();
      return data;
    },
  });

  const { data: required, isLoading } = useQuery({
    queryKey: ["required-inspections", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("required_inspections")
        .select("*")
        .eq("project_id", projectId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as RequiredInspectionRow[];
    },
  });

  const threshold = useMemo(
    () => detectThresholdBuilding(dnaRow as never),
    [dnaRow],
  );

  const derived = useMemo(() => {
    if (!dnaRow) return [];
    return deriveRequiredInspections({
      occupancy_classification: dnaRow.occupancy_classification,
      construction_type: dnaRow.construction_type,
      stories: dnaRow.stories,
      total_sq_ft: dnaRow.total_sq_ft,
      is_high_rise: dnaRow.is_high_rise,
      isThresholdBuilding: threshold.isThresholdBuilding,
      tradeType,
    });
  }, [dnaRow, threshold.isThresholdBuilding, tradeType]);

  const seed = async () => {
    if (!derived.length) {
      toast.error("Project DNA not extracted yet — run AI check first.");
      return;
    }
    setSeeding(true);
    try {
      const existing = new Set((required ?? []).map((r) => r.inspection_type));
      const toInsert = derived
        .filter((d) => !existing.has(d.inspection_type))
        .map((d) => ({
          project_id: projectId,
          inspection_type: d.inspection_type,
          code_basis: d.code_basis,
          is_threshold_inspection: d.is_threshold_inspection,
          trade: d.trade,
          sort_order: d.sort_order,
        }));
      if (toInsert.length === 0) {
        toast.info("All required inspections already on file.");
        return;
      }
      const { error } = await supabase.from("required_inspections").insert(toInsert);
      if (error) throw error;
      toast.success(`Added ${toInsert.length} required inspection${toInsert.length === 1 ? "" : "s"}.`);
      queryClient.invalidateQueries({ queryKey: ["required-inspections", projectId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to seed");
    } finally {
      setSeeding(false);
    }
  };

  // Auto-seed once when DNA is available and no rows exist yet.
  useEffect(() => {
    if (!isLoading && required?.length === 0 && derived.length > 0 && !seeding) {
      void seed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, required?.length, derived.length]);

  const passedCount = (required ?? []).filter((r) => r.status === "passed").length;
  const totalCount = required?.length ?? 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm">Required Inspections</CardTitle>
          {threshold.isThresholdBuilding && (
            <Tooltip>
              <TooltipTrigger>
                <Badge variant="outline" className="gap-1 border-warning/30 text-warning">
                  <ShieldAlert className="h-3 w-3" /> Threshold
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                F.S. 553.79(5) threshold building — Special Inspector items required.
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {passedCount}/{totalCount} passed
          </span>
          {totalCount === 0 && (
            <Button size="sm" variant="outline" onClick={seed} disabled={seeding || !derived.length}>
              {seeding ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
              Generate from plans
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <div key={i} className="h-10 bg-muted rounded animate-pulse" />)}
          </div>
        ) : totalCount === 0 ? (
          <div className="flex items-start gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>
              {derived.length === 0
                ? "Project DNA not yet extracted. Run the AI check on the latest plan review and the required inspections will be generated automatically."
                : `${derived.length} inspections will be derived from plans (FBC Ch. 110${threshold.isThresholdBuilding ? " + F.S. 553.79(5)" : ""}).`}
            </span>
          </div>
        ) : (
          <TooltipProvider>
            <ul className="divide-y divide-border">
              {required!.map((r) => {
                const badge = STATUS_BADGE[r.status] ?? STATUS_BADGE.not_started;
                return (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="flex items-start gap-2 min-w-0">
                      {r.status === "passed" ? (
                        <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0 mt-0.5" />
                      ) : (
                        <ClipboardList className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate flex items-center gap-2">
                          {r.inspection_type}
                          {r.is_threshold_inspection && (
                            <span className="text-[9px] uppercase tracking-wider text-warning">Threshold</span>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground font-mono">{r.code_basis}</div>
                      </div>
                    </div>
                    <Badge variant="outline" className={badge.className}>{badge.label}</Badge>
                  </li>
                );
              })}
            </ul>
          </TooltipProvider>
        )}
      </CardContent>
    </Card>
  );
}
