/**
 * Data layer for the plan-review detail page.
 *
 * Encapsulates the three queries the page needs:
 *  1. The review row (with embedded project + contractor)
 *  2. All sibling rounds for the project (with their findings counts)
 *  3. The v2 findings stream (with realtime subscription that refetches as
 *     the pipeline writes new deficiencies)
 *
 * Keeping these together means the page shell never touches Supabase directly.
 */
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { subscribeShared } from "@/hooks/useReviewDashboard";
import { adaptV2ToFindings, type DeficiencyV2Lite, type SheetMapEntry } from "@/lib/deficiency-adapter";
import type { PlanReviewRow } from "@/types";
import type { Finding } from "@/components/FindingCard";

export interface RoundSummary {
  id: string;
  round: number;
  created_at: string;
  ai_check_status: string;
  findings_count: number;
}

export function usePlanReviewData(reviewId: string | undefined) {
  const queryClient = useQueryClient();

  const reviewQuery = useQuery({
    queryKey: ["plan-review", reviewId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plan_reviews")
        .select(
          "*, project:projects(id, name, address, trade_type, county, jurisdiction, contractor:contractors(id, name, email, phone, license_number))",
        )
        .eq("id", reviewId!)
        .single();
      if (error) throw error;
      return data as PlanReviewRow;
    },
    enabled: !!reviewId,
  });

  const review = reviewQuery.data;

  const roundsQuery = useQuery({
    queryKey: ["plan-review-rounds", review?.project_id],
    queryFn: async (): Promise<RoundSummary[]> => {
      const { data, error } = await supabase
        .from("plan_reviews")
        .select("id, round, created_at, ai_check_status")
        .eq("project_id", review!.project_id)
        .order("round");
      if (error) throw error;
      const ids = (data || []).map((r) => r.id);
      if (ids.length === 0) return (data || []).map((r) => ({ ...r, findings_count: 0 }));
      const { data: defs } = await supabase
        .from("deficiencies_v2")
        .select("plan_review_id")
        .in("plan_review_id", ids);
      const counts = new Map<string, number>();
      (defs || []).forEach((d) => counts.set(d.plan_review_id, (counts.get(d.plan_review_id) || 0) + 1));
      return (data || []).map((r) => ({ ...r, findings_count: counts.get(r.id) || 0 }));
    },
    enabled: !!review?.project_id,
  });

  // Findings live in deficiencies_v2 (verified, dedup'd, with human-review
  // flags). The adapter shapes them into the legacy Finding interface and
  // joins each row to the stored sheet_map snapshot so every finding gets
  // a deterministic pin on the right page in the viewer.
  //
  // We compose the sheet→page map from TWO sources:
  //   1. `plan_reviews.checklist_state.last_sheet_map` — written by the
  //      sheet_map pipeline stage. Authoritative when present.
  //   2. `sheet_coverage` rows — written for every reviewed sheet, including
  //      reviews where last_sheet_map was never persisted. Used as a fallback
  //      so pin placement still works on legacy / partially-failed reviews.
  // Without the fallback, every pin lands at the deterministic-default
  // location with no real page context.
  const checklistMap: SheetMapEntry[] | null =
    ((review as unknown as { checklist_state?: { last_sheet_map?: SheetMapEntry[] } } | undefined)
      ?.checklist_state?.last_sheet_map) ?? null;
  const coverageQuery = useQuery({
    queryKey: ["sheet-coverage-for-pins", review?.id],
    enabled: !!review?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sheet_coverage")
        .select("sheet_ref, page_index")
        .eq("plan_review_id", review!.id);
      if (error) throw error;
      return (data ?? []) as SheetMapEntry[];
    },
  });
  const sheetMap: SheetMapEntry[] | null = (() => {
    const merged = new Map<string, SheetMapEntry>();
    for (const r of coverageQuery.data ?? []) {
      if (r.sheet_ref && typeof r.page_index === "number") {
        merged.set(r.sheet_ref.toUpperCase().trim(), r);
      }
    }
    // checklist_state wins on conflict — it's the authoritative snapshot.
    for (const r of checklistMap ?? []) {
      if (r.sheet_ref && typeof r.page_index === "number") {
        merged.set(r.sheet_ref.toUpperCase().trim(), r);
      }
    }
    return merged.size > 0 ? Array.from(merged.values()) : null;
  })();
  const findingsQuery = useQuery<Finding[]>({
    queryKey: ["v2-findings-for-viewer", review?.id, sheetMap?.length ?? 0],
    enabled: !!review?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deficiencies_v2")
        .select(
          "id, def_number, discipline, finding, required_action, sheet_refs, code_reference, evidence, confidence_score, confidence_basis, priority, life_safety_flag, permit_blocker, liability_flag, requires_human_review, human_review_reason, verification_status, citation_status, status, model_version, evidence_crop_url, evidence_crop_meta",
        )
        .eq("plan_review_id", review!.id)
        .order("def_number", { ascending: true });
      if (error) throw error;
      return adaptV2ToFindings((data ?? []) as DeficiencyV2Lite[], sheetMap);
    },
  });

  // Realtime: as the pipeline writes new findings, refetch so the viewer
  // streams them in (same pattern as the dashboard).
  useEffect(() => {
    if (!review?.id) return;
    return subscribeShared(
      `deficiencies-${review.id}`,
      "deficiencies_v2",
      `plan_review_id=eq.${review.id}`,
      () => {
        queryClient.invalidateQueries({ queryKey: ["v2-findings-for-viewer", review.id] });
      },
    );
  }, [review?.id, queryClient]);

  return {
    review,
    isLoading: reviewQuery.isLoading,
    rounds: roundsQuery.data ?? [],
    findings: findingsQuery.data ?? [],
  };
}
