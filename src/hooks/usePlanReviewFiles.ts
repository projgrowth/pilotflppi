import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PlanReviewFile {
  id: string;
  plan_review_id: string;
  file_path: string;
  round: number;
  uploaded_at: string;
  uploaded_by: string | null;
}

export function usePlanReviewFiles(planReviewId: string | undefined) {
  return useQuery({
    queryKey: ["plan-review-files", planReviewId],
    queryFn: async () => {
      if (!planReviewId) return [];
      const { data, error } = await supabase
        .from("plan_review_files")
        .select("*")
        .eq("plan_review_id", planReviewId)
        .order("round")
        .order("uploaded_at");
      if (error) throw error;
      return data as PlanReviewFile[];
    },
    enabled: !!planReviewId,
  });
}

export function usePlanReviewFilesByProject(projectId: string | undefined) {
  return useQuery({
    queryKey: ["plan-review-files-by-project", projectId],
    queryFn: async () => {
      if (!projectId) return [];
      // Get all plan reviews for this project, then fetch their files
      const { data: reviews, error: revErr } = await supabase
        .from("plan_reviews")
        .select("id, round")
        .eq("project_id", projectId);
      if (revErr) throw revErr;
      if (!reviews || reviews.length === 0) return [];

      const reviewIds = reviews.map((r) => r.id);
      const { data, error } = await supabase
        .from("plan_review_files")
        .select("*")
        .in("plan_review_id", reviewIds)
        .order("round")
        .order("uploaded_at");
      if (error) throw error;
      return data as PlanReviewFile[];
    },
    enabled: !!projectId,
  });
}

export function groupFilesByRound(files: PlanReviewFile[]): Record<number, PlanReviewFile[]> {
  const groups: Record<number, PlanReviewFile[]> = {};
  for (const f of files) {
    if (!groups[f.round]) groups[f.round] = [];
    groups[f.round].push(f);
  }
  return groups;
}
