/**
 * Server-validated admin flag. Reads from `user_roles` via the SECURITY DEFINER
 * `has_role` RPC — never trusts localStorage or hardcoded ids. Cached for the
 * session so dependent UI doesn't flicker.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useIsAdmin(): boolean {
  const { data } = useQuery({
    queryKey: ["is-admin"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return false;
      const { data: result, error } = await supabase.rpc("has_role", {
        _user_id: uid,
        _role: "admin",
      });
      if (error) return false;
      return result === true;
    },
  });
  return data === true;
}
