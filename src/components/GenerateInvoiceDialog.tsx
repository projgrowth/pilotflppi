import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useFeeSchedules } from "@/hooks/useFeeSchedule";
import { useCreateInvoice, useGenerateInvoiceNumber } from "@/hooks/useInvoices";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2, Loader2, GripVertical } from "lucide-react";
import { format, addDays } from "date-fns";

interface LineItemDraft {
  description: string;
  quantity: number;
  unit_price: number;
  service_type: string;
  sort_order: number;
}

export function GenerateInvoiceDialog({
  open, onOpenChange, projectId, contractorId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  contractorId: string | null;
}) {
  const { data: fees } = useFeeSchedules();
  const createMutation = useCreateInvoice();
  const genNumber = useGenerateInvoiceNumber();

  const { data: project } = useQuery({
    queryKey: ["project-for-invoice", projectId],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("trade_type, county, services").eq("id", projectId).single();
      return data;
    },
    enabled: !!projectId && open,
  });

  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [dueDate, setDueDate] = useState(format(addDays(new Date(), 30), "yyyy-MM-dd"));
  const [taxRate, setTaxRate] = useState(0);
  const [notes, setNotes] = useState("");
  const [customFooter, setCustomFooter] = useState("");
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([]);

  // Auto-generate number on open
  useEffect(() => {
    if (open) {
      genNumber.mutate(undefined, {
        onSuccess: (num) => setInvoiceNumber(num),
      });
    }
  }, [open]);

  // Auto-populate line items from fee schedule
  useEffect(() => {
    if (!open || !project || !fees) return;
    const matching = fees.filter(
      (f) => f.is_active &&
        (f.trade_type === project.trade_type || f.trade_type === "building") &&
        (!f.county || f.county === project.county)
    );
    if (matching.length > 0 && lineItems.length === 0) {
      setLineItems(
        matching.map((f, i) => ({
          description: `${f.description || f.service_type.replace(/_/g, " ")} — ${f.trade_type}`,
          quantity: 1,
          unit_price: Number(f.base_fee),
          service_type: f.service_type,
          sort_order: i,
        }))
      );
    }
  }, [open, project, fees]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setLineItems([]);
      setNotes("");
      setCustomFooter("");
      setTaxRate(0);
    }
  }, [open]);

  const addLineItem = () => {
    setLineItems([...lineItems, { description: "", quantity: 1, unit_price: 0, service_type: "custom", sort_order: lineItems.length }]);
  };

  const updateLineItem = <K extends keyof LineItemDraft>(idx: number, field: K, value: LineItemDraft[K]) => {
    setLineItems(lineItems.map((li, i) => i === idx ? { ...li, [field]: value } : li));
  };

  const removeLineItem = (idx: number) => setLineItems(lineItems.filter((_, i) => i !== idx));

  const subtotal = lineItems.reduce((s, li) => s + li.quantity * li.unit_price, 0);
  const taxAmount = Math.round(subtotal * taxRate * 100) / 100;
  const total = subtotal + taxAmount;

  const handleSubmit = () => {
    if (!invoiceNumber.trim()) return;
    createMutation.mutate(
      {
        project_id: projectId,
        contractor_id: contractorId,
        invoice_number: invoiceNumber.trim(),
        due_at: dueDate || null,
        notes,
        tax_rate: taxRate,
        custom_footer: customFooter,
        line_items: lineItems.map((li, i) => ({ ...li, sort_order: i })),
      },
      { onSuccess: () => onOpenChange(false) }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Generate Invoice</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Invoice details */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">Invoice #</Label>
              <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className="text-sm font-mono" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Due Date</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tax Rate (%)</Label>
              <Input type="number" step="0.01" value={taxRate * 100 || ""} onChange={(e) => setTaxRate(parseFloat(e.target.value) / 100 || 0)} className="text-sm" />
            </div>
          </div>

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs">Line Items</Label>
              <Button variant="ghost" size="sm" className="text-xs" onClick={addLineItem}>
                <Plus className="h-3 w-3 mr-1" /> Add Item
              </Button>
            </div>

            {lineItems.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No line items. Add items or they'll auto-populate from your fee schedule.</p>
            ) : (
              <div className="space-y-2">
                {lineItems.map((li, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_60px_90px_32px] gap-2 items-end">
                    <div>
                      {idx === 0 && <Label className="text-[10px] text-muted-foreground">Description</Label>}
                      <Input value={li.description} onChange={(e) => updateLineItem(idx, "description", e.target.value)} className="text-sm" placeholder="Service description" />
                    </div>
                    <div>
                      {idx === 0 && <Label className="text-[10px] text-muted-foreground">Qty</Label>}
                      <Input type="number" min={1} value={li.quantity} onChange={(e) => updateLineItem(idx, "quantity", parseInt(e.target.value) || 1)} className="text-sm" />
                    </div>
                    <div>
                      {idx === 0 && <Label className="text-[10px] text-muted-foreground">Unit Price</Label>}
                      <Input type="number" step="0.01" value={li.unit_price || ""} onChange={(e) => updateLineItem(idx, "unit_price", parseFloat(e.target.value) || 0)} className="text-sm" />
                    </div>
                    <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive" onClick={() => removeLineItem(idx)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Totals */}
          <div className="border-t pt-3 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="font-mono">${subtotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span></div>
            {taxRate > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Tax ({(taxRate * 100).toFixed(2)}%)</span><span className="font-mono">${taxAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span></div>}
            <div className="flex justify-between font-semibold text-base border-t pt-2"><span>Total</span><span className="font-mono">${total.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span></div>
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <Label className="text-xs">Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="text-sm" placeholder="Payment terms, special instructions..." />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Custom Footer (optional)</Label>
            <Input value={customFooter} onChange={(e) => setCustomFooter(e.target.value)} className="text-sm" placeholder="Thank you for your business" />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending || lineItems.length === 0} className="bg-accent text-accent-foreground hover:bg-accent/90">
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Create Draft Invoice
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
