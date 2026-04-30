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
  block_letter_on_low_coverage?: boolean;
  block_letter_on_ungrounded?: boolean;
  block_review_on_incomplete_submittal?: boolean;
  // F.S. 553.791(20) — minimum $1M E&O coverage required for FL private providers
  eo_carrier?: string | null;
  eo_policy_number?: string | null;
  eo_coverage_amount?: number | null;
  eo_expires_on?: string | null;
  // Per-firm beta feature toggles (jsonb). Keys correspond to FeatureFlag union.
  feature_flags?: Record<string, boolean> | null;
}

const DEFAULT_FIRM: Omit<FirmSettings, "id" | "user_id"> = {
  firm_name: "",
  license_number: "",
  email: "",
  phone: "",
  address: "",
  logo_url: "",
  closing_language: "",
  block_letter_on_low_coverage: true,
  block_letter_on_ungrounded: true,
  block_review_on_incomplete_submittal: false,
  eo_carrier: "",
  eo_policy_number: "",
  eo_coverage_amount: null,
  eo_expires_on: null,
};

export function useFirmSettings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["firm-settings", user?.id],
    queryFn: async () => {
      if (!user) return null;
      // RLS scopes row to caller's firm; one row per firm enforced by unique index
      const { data, error } = await supabase
        .from("firm_settings")
        .select("*")
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
          .eq("id", query.data.id);
        if (error) throw error;
      } else {
        // firm_id is auto-populated by trigger; user_id retained for audit
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
