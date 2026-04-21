import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PipelineStage =
  | "upload"
  | "sheet_map"
  | "dna_extract"
  | "discipline_review"
  | "verify"
  | "cross_check"
  | "deferred_scope"
  | "prioritize"
  | "complete";

export const PIPELINE_STAGES: { key: PipelineStage; label: string }[] = [
  { key: "upload", label: "Upload" },
  { key: "sheet_map", label: "Sheet Map" },
  { key: "dna_extract", label: "DNA Extract" },
  { key: "discipline_review", label: "Discipline Review" },
  { key: "verify", label: "Verify" },
  { key: "cross_check", label: "Cross-Check" },
  { key: "deferred_scope", label: "Deferred Scope" },
  { key: "prioritize", label: "Prioritize" },
  { key: "complete", label: "Complete" },
];

export interface PipelineRow {
  id: string;
  plan_review_id: string;
  stage: PipelineStage;
  status: "pending" | "running" | "complete" | "error";
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}

export interface ProjectDnaRow {
  id: string;
  plan_review_id: string;
  occupancy_classification: string | null;
  construction_type: string | null;
  total_sq_ft: number | null;
  stories: number | null;
  fbc_edition: string | null;
  jurisdiction: string | null;
  county: string | null;
  hvhz: boolean | null;
  flood_zone: string | null;
  wind_speed_vult: number | null;
  exposure_category: string | null;
  risk_category: string | null;
  seismic_design_category: string | null;
  has_mezzanine: boolean | null;
  is_high_rise: boolean | null;
  mixed_occupancy: boolean | null;
  missing_fields: string[] | null;
  ambiguous_fields: string[] | null;
}

export interface SheetCoverageRow {
  id: string;
  sheet_ref: string;
  sheet_title: string | null;
  discipline: string | null;
  status: "present" | "missing_critical" | "missing_minor" | "extra";
  expected: boolean;
  page_index: number | null;
}

export interface DeficiencyV2Row {
  id: string;
  def_number: string;
  discipline: string;
  sheet_refs: string[];
  code_reference: { code?: string; section?: string; edition?: string } | null;
  finding: string;
  required_action: string;
  evidence: string[];
  priority: "high" | "medium" | "low";
  life_safety_flag: boolean;
  permit_blocker: boolean;
  liability_flag: boolean;
  requires_human_review: boolean;
  human_review_reason: string | null;
  human_review_verify: string | null;
  human_review_method: string | null;
  confidence_score: number | null;
  confidence_basis: string | null;
  reviewer_disposition: "confirm" | "reject" | "modify" | null;
  reviewer_notes: string;
  status: "open" | "resolved" | "waived" | "needs_info";
  verification_status: "unverified" | "verified" | "overturned" | "modified";
  verification_notes: string;
}

export function usePipelineStatus(planReviewId?: string) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["pipeline_status", planReviewId],
    enabled: !!planReviewId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("review_pipeline_status")
        .select("*")
        .eq("plan_review_id", planReviewId!);
      if (error) throw error;
      return (data ?? []) as unknown as PipelineRow[];
    },
  });

  // Realtime subscription so the stepper updates live
  useEffect(() => {
    if (!planReviewId) return;
    const ch = supabase
      .channel(`pipeline-${planReviewId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "review_pipeline_status",
          filter: `plan_review_id=eq.${planReviewId}`,
        },
        () => qc.invalidateQueries({ queryKey: ["pipeline_status", planReviewId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [planReviewId, qc]);

  return query;
}

export function useProjectDna(planReviewId?: string) {
  return useQuery({
    queryKey: ["project_dna", planReviewId],
    enabled: !!planReviewId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_dna")
        .select("*")
        .eq("plan_review_id", planReviewId!)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as ProjectDnaRow | null;
    },
  });
}

export function useSheetCoverage(planReviewId?: string) {
  return useQuery({
    queryKey: ["sheet_coverage", planReviewId],
    enabled: !!planReviewId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sheet_coverage")
        .select("*")
        .eq("plan_review_id", planReviewId!)
        .order("sheet_ref", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as SheetCoverageRow[];
    },
  });
}

export function useDeficienciesV2(planReviewId?: string) {
  return useQuery({
    queryKey: ["deficiencies_v2", planReviewId],
    enabled: !!planReviewId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deficiencies_v2")
        .select("*")
        .eq("plan_review_id", planReviewId!)
        .order("def_number", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as DeficiencyV2Row[];
    },
  });
}

export async function updateDeficiencyDisposition(
  id: string,
  patch: Partial<Pick<DeficiencyV2Row, "reviewer_disposition" | "reviewer_notes" | "status">>,
) {
  const { error } = await supabase.from("deficiencies_v2").update(patch).eq("id", id);
  if (error) throw error;
}

export type DeferredScopeCategory =
  | "fire_sprinkler"
  | "fire_alarm"
  | "pre_engineered_metal_building"
  | "truss_shop_drawings"
  | "elevators"
  | "kitchen_hood"
  | "stair_pressurization"
  | "smoke_control"
  | "curtain_wall"
  | "storefront_glazing"
  | "other";

export interface DeferredScopeItem {
  id: string;
  plan_review_id: string;
  category: DeferredScopeCategory;
  description: string;
  sheet_refs: string[];
  evidence: string[];
  required_submittal: string;
  responsible_party: string;
  confidence_score: number | null;
  status: "pending" | "acknowledged" | "dismissed";
  reviewer_notes: string;
  created_at: string;
  updated_at: string;
}

export const DEFERRED_SCOPE_LABELS: Record<DeferredScopeCategory, string> = {
  fire_sprinkler: "Fire Sprinkler",
  fire_alarm: "Fire Alarm",
  pre_engineered_metal_building: "Pre-Engineered Metal Building",
  truss_shop_drawings: "Truss Shop Drawings",
  elevators: "Elevators",
  kitchen_hood: "Kitchen Hood",
  stair_pressurization: "Stair Pressurization",
  smoke_control: "Smoke Control",
  curtain_wall: "Curtain Wall",
  storefront_glazing: "Storefront Glazing",
  other: "Other",
};

export function useDeferredScope(planReviewId?: string) {
  return useQuery({
    queryKey: ["deferred_scope", planReviewId],
    enabled: !!planReviewId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deferred_scope_items")
        .select("*")
        .eq("plan_review_id", planReviewId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as DeferredScopeItem[];
    },
  });
}

export async function updateDeferredScopeItem(
  id: string,
  patch: Partial<Pick<DeferredScopeItem, "status" | "reviewer_notes">>,
) {
  const { error } = await supabase
    .from("deferred_scope_items")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
}
