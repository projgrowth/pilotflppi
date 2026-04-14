import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface FindingHistoryEntry {
  id: string;
  plan_review_id: string;
  finding_index: number;
  old_status: string;
  new_status: string;
  changed_by: string;
  changed_at: string;
  note: string;
}

export function useFindingHistory(planReviewId: string | undefined) {
  return useQuery({
    queryKey: ["finding-history", planReviewId],
    queryFn: async () => {
      if (!planReviewId) return [];
      const { data, error } = await supabase
        .from("finding_status_history")
        .select("*")
        .eq("plan_review_id", planReviewId)
        .order("changed_at", { ascending: false });
      if (error) throw error;
      return data as FindingHistoryEntry[];
    },
    enabled: !!planReviewId,
  });
}

export async function logFindingStatusChange(
  planReviewId: string,
  findingIndex: number,
  oldStatus: string,
  newStatus: string,
  userId: string,
  note?: string
) {
  const { error } = await supabase
    .from("finding_status_history")
    .insert({
      plan_review_id: planReviewId,
      finding_index: findingIndex,
      old_status: oldStatus,
      new_status: newStatus,
      changed_by: userId,
      note: note || "",
    });
  if (error) { /* finding history log failed silently */ }
}
