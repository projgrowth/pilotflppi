/**
 * useAhjRecipients — per-firm address book for building department / AHJ
 * contacts. Backs the autocomplete on RecordDeliveryDialog and the CoC
 * recipient field. Reduces retyping the same building department 50 times
 * during a beta cycle.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useFirmId } from "@/hooks/useFirmId";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface AhjRecipient {
  id: string;
  firm_id: string | null;
  jurisdiction: string;
  department: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string;
  last_used_at: string | null;
  use_count: number;
  created_at: string;
  updated_at: string;
}

export function useAhjRecipients(jurisdictionFilter?: string) {
  const { firmId } = useFirmId();
  return useQuery({
    queryKey: ["ahj_recipients", firmId, jurisdictionFilter ?? null],
    queryFn: async (): Promise<AhjRecipient[]> => {
      if (!firmId) return [];
      let q = supabase
        .from("ahj_recipients")
        .select("*")
        .eq("firm_id", firmId)
        .order("last_used_at", { ascending: false, nullsFirst: false })
        .order("use_count", { ascending: false })
        .limit(50);
      if (jurisdictionFilter && jurisdictionFilter.trim()) {
        q = q.ilike("jurisdiction", `%${jurisdictionFilter.trim()}%`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AhjRecipient[];
    },
    enabled: !!firmId,
    staleTime: 60_000,
  });
}

export function useUpsertAhjRecipient() {
  const qc = useQueryClient();
  const { firmId } = useFirmId();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      jurisdiction: string;
      department?: string | null;
      contact_name?: string | null;
      email?: string | null;
      phone?: string | null;
      address?: string | null;
      notes?: string;
    }) => {
      if (!firmId) throw new Error("No firm membership");
      const jurisdiction = input.jurisdiction.trim().slice(0, 200);
      if (!jurisdiction) throw new Error("Jurisdiction is required");

      // Try to find an existing row by firm + jurisdiction + email (loose dedupe)
      const { data: existing } = await supabase
        .from("ahj_recipients")
        .select("id, use_count")
        .eq("firm_id", firmId)
        .eq("jurisdiction", jurisdiction)
        .eq("email", (input.email ?? "").trim() || "")
        .maybeSingle();

      const payload = {
        firm_id: firmId,
        jurisdiction,
        department: input.department?.trim().slice(0, 200) || null,
        contact_name: input.contact_name?.trim().slice(0, 200) || null,
        email: input.email?.trim().slice(0, 200) || null,
        phone: input.phone?.trim().slice(0, 50) || null,
        address: input.address?.trim().slice(0, 500) || null,
        notes: (input.notes ?? "").slice(0, 1000),
        last_used_at: new Date().toISOString(),
      };

      if (existing?.id) {
        const { error } = await supabase
          .from("ahj_recipients")
          .update({ ...payload, use_count: (existing.use_count ?? 0) + 1 })
          .eq("id", existing.id);
        if (error) throw error;
        return existing.id;
      }
      const { data, error } = await supabase
        .from("ahj_recipients")
        .insert({ ...payload, use_count: 1, created_by: user?.id ?? null })
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ahj_recipients"] });
    },
    onError: (e) =>
      toast.error(`Failed to save AHJ contact: ${e instanceof Error ? e.message : String(e)}`),
  });
}
