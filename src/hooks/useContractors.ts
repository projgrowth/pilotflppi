import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Contractor {
  id: string;
  name: string;
  license_number: string | null;
  email: string | null;
  phone: string | null;
  portal_access: boolean;
  user_id: string | null;
  created_at: string;
  updated_at: string;
}

export function useContractors() {
  return useQuery({
    queryKey: ["contractors"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contractors")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as Contractor[];
    },
  });
}
