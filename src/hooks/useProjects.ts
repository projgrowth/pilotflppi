import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Project {
  id: string;
  name: string;
  address: string;
  county: string;
  jurisdiction: string;
  trade_type: string;
  services: string[];
  status: string;
  notice_filed_at: string | null;
  deadline_at: string | null;
  assigned_to: string | null;
  contractor_id: string | null;
  created_at: string;
  updated_at: string;
  contractor?: { id: string; name: string } | null;
  // Statutory fields (F.S. 553.791)
  statutory_review_days: number;
  statutory_inspection_days: number;
  statutory_deadline_at: string | null;
  review_clock_started_at: string | null;
  review_clock_paused_at: string | null;
  hold_reason: string | null;
}

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*, contractor:contractors(id, name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Project[];
    },
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: ["project", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*, contractor:contractors(id, name)")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as Project;
    },
    enabled: !!id,
  });
}

export function getDaysElapsed(noticeFiledAt: string | null): number {
  if (!noticeFiledAt) return 0;
  const filed = new Date(noticeFiledAt);
  const now = new Date();
  return Math.max(0, Math.floor((now.getTime() - filed.getTime()) / (1000 * 60 * 60 * 24)));
}

export function getDaysRemaining(deadlineAt: string | null): number {
  if (!deadlineAt) return 21;
  const deadline = new Date(deadlineAt);
  const now = new Date();
  return Math.floor((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}
