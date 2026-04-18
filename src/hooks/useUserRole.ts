import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type AppRole = "admin" | "reviewer" | "qc" | "viewer";

/**
 * Returns whether the current user has a given role.
 *
 * Backed by the `user_roles` table + `has_role()` SECURITY DEFINER function
 * — never trust `profiles.role` for permission checks (it's writable by the
 * row owner via RLS).
 */
export function useHasRole(role: AppRole): { hasRole: boolean; loading: boolean } {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["user_roles", user?.id, role],
    queryFn: async () => {
      if (!user) return false;
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", role)
        .maybeSingle();
      if (error) return false;
      return !!data;
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  return { hasRole: !!data, loading: isLoading };
}

/**
 * Returns all roles for the current user. Used by the Settings UI to render
 * "you are: admin, reviewer" chips.
 */
export function useUserRoles(): { roles: AppRole[]; loading: boolean } {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["user_roles_all", user?.id],
    queryFn: async () => {
      if (!user) return [] as AppRole[];
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      if (error) return [] as AppRole[];
      return (data || []).map((r) => r.role as AppRole);
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  return { roles: data || [], loading: isLoading };
}
