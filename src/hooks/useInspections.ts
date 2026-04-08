import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Inspection {
  id: string;
  project_id: string;
  scheduled_at: string | null;
  inspector_id: string | null;
  inspection_type: string;
  result: string;
  virtual: boolean;
  video_call_url: string | null;
  certificate_issued: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  project?: { id: string; name: string; address: string; trade_type: string } | null;
}

export function useInspections() {
  return useQuery({
    queryKey: ["inspections"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inspections")
        .select("*, project:projects(id, name, address, trade_type)")
        .order("scheduled_at", { ascending: true });
      if (error) throw error;
      return data as Inspection[];
    },
  });
}
