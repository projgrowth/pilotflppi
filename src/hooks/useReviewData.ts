import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ReviewFlag {
  id: string;
  project_id: string;
  sheet_ref: string | null;
  detail_ref: string | null;
  fbc_section: string | null;
  description: string | null;
  severity: string | null;
  confidence: string | null;
  status: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

export interface Deficiency {
  id: string;
  fbc_section: string;
  title: string;
  discipline: string | null;
  severity: string | null;
  description: string | null;
  standard_comment_language: string | null;
  is_florida_specific: boolean;
  created_at: string;
}

export function useReviewFlags(projectId?: string) {
  return useQuery({
    queryKey: ["review_flags", projectId],
    queryFn: async () => {
      let query = supabase.from("review_flags").select("*").order("created_at", { ascending: false });
      if (projectId) query = query.eq("project_id", projectId);
      const { data, error } = await query;
      if (error) throw error;
      return data as ReviewFlag[];
    },
    enabled: !!projectId || projectId === undefined,
  });
}

export function useDeficiencies() {
  return useQuery({
    queryKey: ["deficiencies"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deficiencies")
        .select("*")
        .order("fbc_section", { ascending: true });
      if (error) throw error;
      return data as Deficiency[];
    },
  });
}

export function useAIOutputs(projectId?: string) {
  return useQuery({
    queryKey: ["ai_outputs", projectId],
    queryFn: async () => {
      let query = supabase.from("ai_outputs").select("*").order("created_at", { ascending: false });
      if (projectId) query = query.eq("project_id", projectId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useReviewFlagCounts() {
  return useQuery({
    queryKey: ["review_flag_counts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("review_flags").select("severity, status");
      if (error) throw error;
      const counts = { critical: 0, major: 0, minor: 0, admin: 0, resolved: 0, total: 0 };
      (data || []).forEach((f: any) => {
        if (f.status === "resolved") counts.resolved++;
        else if (f.severity && f.severity in counts) (counts as any)[f.severity]++;
        counts.total++;
      });
      return counts;
    },
  });
}
