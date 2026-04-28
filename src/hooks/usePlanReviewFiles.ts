/**
 * Plan-review file listing hook — surfaces uploaded plan PDFs for a project.
 * Used by ProjectDetail to show recent submittals.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PlanReviewFile {
  id: string;
  plan_review_id: string;
  storage_path: string;
  filename: string;
  round: number | null;
  created_at: string;
  pdf_sha256: string | null;
  file_size_bytes: number | null;
}

export function usePlanReviewFilesByProject(projectId: string | undefined) {
  return useQuery({
    queryKey: ["plan_review_files", "project", projectId],
    enabled: !!projectId,
    queryFn: async (): Promise<PlanReviewFile[]> => {
      const { data: reviews, error: revErr } = await supabase
        .from("plan_reviews")
        .select("id")
        .eq("project_id", projectId!);
      if (revErr) throw revErr;
      const ids = (reviews ?? []).map((r) => r.id);
      if (ids.length === 0) return [];

      const { data, error } = await supabase
        .from("plan_review_files")
        .select("id, plan_review_id, storage_path, filename, round, created_at, pdf_sha256, file_size_bytes")
        .in("plan_review_id", ids)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PlanReviewFile[];
    },
  });
}
