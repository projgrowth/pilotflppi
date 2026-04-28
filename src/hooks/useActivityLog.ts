/**
 * Project activity log hook — fetches activity_log rows for a project,
 * newest first. Used by ProjectDetail's Activity tab.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ActivityEntry {
  id: string;
  event_type: string;
  description: string;
  created_at: string;
  actor_type: string | null;
  metadata: Record<string, unknown> | null;
}

export function useProjectActivityLog(projectId: string) {
  return useQuery({
    queryKey: ["activity_log", "project", projectId],
    enabled: !!projectId,
    queryFn: async (): Promise<ActivityEntry[]> => {
      const { data, error } = await supabase
        .from("activity_log")
        .select("id, event_type, description, created_at, actor_type, metadata")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as ActivityEntry[];
    },
  });
}

/** Maps an activity event_type to a Tailwind bg-color class for the timeline dot. */
export function getEventColor(eventType: string): string {
  if (eventType.includes("error") || eventType.includes("overdue") || eventType.includes("failed")) {
    return "bg-destructive";
  }
  if (eventType.includes("warning") || eventType.includes("paused") || eventType.includes("hold")) {
    return "bg-warning";
  }
  if (eventType.includes("complete") || eventType.includes("issued") || eventType.includes("approved")) {
    return "bg-primary";
  }
  return "bg-muted-foreground";
}
