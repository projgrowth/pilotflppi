import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Returns the current user's firm_id (the workspace they belong to).
 *
 * Every authenticated request that writes a tenant row should inject this
 * value. Reads are already filtered by RLS, so adding `.eq("firm_id", id)`
 * is optional for selects — but doing it shaves work off the planner.
 *
 * If the user has no membership yet (edge case for users created before
 * Phase 2 ran somehow), this returns null and the caller should treat
 * that as "loading."
 */
export function useFirmId(): { firmId: string | null; loading: boolean } {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["firm_id", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("firm_members")
        .select("firm_id, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error || !data) return null;
      return data.firm_id as string;
    },
    enabled: !!user,
    staleTime: 30 * 60 * 1000, // firm membership rarely changes mid-session
  });

  return { firmId: data ?? null, loading: isLoading };
}
