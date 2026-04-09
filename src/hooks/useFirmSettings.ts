import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface FirmSettings {
  id: string;
  user_id: string;
  firm_name: string;
  license_number: string;
  email: string;
  phone: string;
  address: string;
  logo_url: string;
  closing_language: string;
}

const DEFAULT_FIRM: Omit<FirmSettings, "id" | "user_id"> = {
  firm_name: "",
  license_number: "",
  email: "",
  phone: "",
  address: "",
  logo_url: "",
  closing_language: "",
};

export function useFirmSettings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["firm-settings", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("firm_settings")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data as FirmSettings | null;
    },
    enabled: !!user,
  });

  const mutation = useMutation({
    mutationFn: async (updates: Partial<Omit<FirmSettings, "id" | "user_id">>) => {
      if (!user) throw new Error("Not authenticated");

      if (query.data) {
        const { error } = await supabase
          .from("firm_settings")
          .update(updates)
          .eq("user_id", user.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("firm_settings")
          .insert({ user_id: user.id, ...DEFAULT_FIRM, ...updates });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["firm-settings"] });
      toast.success("Firm settings saved");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    },
  });

  return {
    firmSettings: query.data,
    isLoading: query.isLoading,
    saveFirmSettings: mutation.mutate,
    isSaving: mutation.isPending,
  };
}
