import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface Invoice {
  id: string;
  user_id: string;
  project_id: string;
  contractor_id: string | null;
  invoice_number: string;
  status: string;
  issued_at: string | null;
  due_at: string | null;
  paid_at: string | null;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  amount_paid: number;
  notes: string;
  custom_footer: string;
  created_at: string;
  updated_at: string;
  // joined
  project?: { name: string; address: string };
  contractor?: { name: string; email: string | null };
}

export interface InvoiceLineItem {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
  service_type: string | null;
  sort_order: number;
  created_at: string;
}

export function useInvoices() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["invoices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("*, project:projects(name, address), contractor:contractors(name, email)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as Invoice[];
    },
    enabled: !!user,
  });
}

export function useProjectInvoices(projectId: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["invoices", "project", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("*, contractor:contractors(name, email)")
        .eq("project_id", projectId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as Invoice[];
    },
    enabled: !!user && !!projectId,
  });
}

export function useInvoiceLineItems(invoiceId: string | undefined) {
  return useQuery({
    queryKey: ["invoice-line-items", invoiceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_line_items")
        .select("*")
        .eq("invoice_id", invoiceId!)
        .order("sort_order");
      if (error) throw error;
      return (data || []) as InvoiceLineItem[];
    },
    enabled: !!invoiceId,
  });
}

export function useCreateInvoice() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      project_id: string;
      contractor_id?: string | null;
      invoice_number: string;
      due_at?: string | null;
      notes?: string;
      tax_rate?: number;
      custom_footer?: string;
      line_items: { description: string; quantity: number; unit_price: number; service_type?: string; sort_order: number }[];
    }) => {
      if (!user) throw new Error("Not authenticated");
      const { line_items, ...invoiceData } = params;
      const subtotal = line_items.reduce((s, li) => s + li.quantity * li.unit_price, 0);
      const taxRate = invoiceData.tax_rate || 0;
      const taxAmount = Math.round(subtotal * taxRate * 100) / 100;
      const total = subtotal + taxAmount;

      const { data: inv, error } = await supabase
        .from("invoices")
        .insert({
          project_id: invoiceData.project_id,
          contractor_id: invoiceData.contractor_id ?? null,
          invoice_number: invoiceData.invoice_number,
          due_at: invoiceData.due_at ?? null,
          notes: invoiceData.notes ?? "",
          tax_rate: taxRate,
          custom_footer: invoiceData.custom_footer ?? "",
          user_id: user.id,
          subtotal,
          tax_amount: taxAmount,
          total,
          status: "draft",
        })
        .select("id")
        .single();
      if (error) throw error;

      const invoiceId = inv.id;
      if (line_items.length > 0) {
        const rows = line_items.map((li) => ({
          invoice_id: invoiceId,
          description: li.description,
          quantity: li.quantity,
          unit_price: li.unit_price,
          total: li.quantity * li.unit_price,
          service_type: li.service_type || null,
          sort_order: li.sort_order,
        }));
        const { error: liErr } = await supabase.from("invoice_line_items").insert(rows);
        if (liErr) throw liErr;
      }
      return invoiceId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Invoice created");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to create invoice"),
  });
}

export function useUpdateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Invoice> & { id: string }) => {
      // Strip joined/read-only fields before sending to DB
      const { project: _p, contractor: _c, user_id: _u, created_at: _ca, updated_at: _ua, ...rest } = updates;
      const { error } = await supabase
        .from("invoices")
        .update(rest)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Invoice updated");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to update"),
  });
}

export function useDeleteInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("invoices").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Invoice deleted");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to delete"),
  });
}

export function useGenerateInvoiceNumber() {
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("generate_invoice_number");
      if (error) throw error;
      return data as string;
    },
  });
}

