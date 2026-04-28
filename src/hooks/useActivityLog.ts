import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ActivityEntry {
  id: string;
  project_id: string | null;
  actor_type: string;
  event_type: string;
  description: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export function useActivityLog(limit = 10) {
  return useQuery({
    queryKey: ["activity-log", limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data as ActivityEntry[];
    },
  });
}

export function useProjectActivityLog(projectId: string) {
  return useQuery({
    queryKey: ["activity-log", "project", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_log")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ActivityEntry[];
    },
    enabled: !!projectId,
  });
}

const eventColorMap: Record<string, string> = {
  intake: "bg-accent",
  plan_review_started: "bg-teal",
  comments_sent: "bg-warning",
  approved: "bg-success",
  inspection_scheduled: "bg-teal",
  deadline_warning: "bg-destructive",
  certificate_issued: "bg-success",
};

export function getEventColor(eventType: string): string {
  return eventColorMap[eventType] || "bg-muted-foreground";
}
