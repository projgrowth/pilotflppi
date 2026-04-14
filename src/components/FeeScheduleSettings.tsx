import { useState } from "react";
import { useFeeSchedules, useSaveFeeSchedule, useDeleteFeeSchedule, FeeSchedule } from "@/hooks/useFeeSchedule";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, X, Loader2 } from "lucide-react";

const SERVICE_TYPES = [
  { value: "plan_review", label: "Plan Review" },
  { value: "inspection", label: "Inspection" },
  { value: "resubmission", label: "Re-Review" },
  { value: "expedited", label: "Expedited Surcharge" },
  { value: "custom", label: "Custom" },
];

const TRADE_TYPES = ["building", "electrical", "plumbing", "mechanical", "fire", "structural", "roofing"];

export function FeeScheduleSettings() {
  const { data: fees, isLoading } = useFeeSchedules();
  const saveMutation = useSaveFeeSchedule();
  const deleteMutation = useDeleteFeeSchedule();
  const [editing, setEditing] = useState<Partial<FeeSchedule> | null>(null);

  const startNew = () => setEditing({
    service_type: "plan_review",
    trade_type: "building",
    county: "",
    base_fee: 0,
    description: "",
    is_active: true,
  });

  const handleSave = () => {
    if (!editing) return;
    saveMutation.mutate(editing as FeeSchedule, { onSuccess: () => setEditing(null) });
  };

  if (isLoading) {
    return <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-12 rounded bg-muted animate-pulse" />
      ))}
    </div>;
  }

  return (
    <Card className="shadow-subtle">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Fee Schedule</CardTitle>
        <Button size="sm" variant="outline" onClick={startNew}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add Rate
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Default rates used to auto-populate invoices. You can always override fees per invoice.
        </p>

        {editing && (
          <Card className="border-accent/30 bg-accent/5">
            <CardContent className="p-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Service Type</Label>
                  <Select value={editing.service_type || "plan_review"} onValueChange={(v) => setEditing({ ...editing, service_type: v })}>
                    <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SERVICE_TYPES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Trade</Label>
                  <Select value={editing.trade_type || "building"} onValueChange={(v) => setEditing({ ...editing, trade_type: v })}>
                    <SelectTrigger className="text-sm capitalize"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TRADE_TYPES.map((t) => (
                        <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">County (optional)</Label>
                  <Input value={editing.county || ""} onChange={(e) => setEditing({ ...editing, county: e.target.value })} placeholder="All counties" className="text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Base Fee ($)</Label>
                  <Input type="number" step="0.01" value={editing.base_fee || ""} onChange={(e) => setEditing({ ...editing, base_fee: parseFloat(e.target.value) || 0 })} className="text-sm" />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Description</Label>
                <Input value={editing.description || ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} placeholder="e.g. Per review round" className="text-sm" />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending} className="bg-accent text-accent-foreground hover:bg-accent/90">
                  {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                  <X className="h-3.5 w-3.5 mr-1" /> Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {(fees || []).length === 0 && !editing ? (
          <p className="text-sm text-muted-foreground text-center py-8">No fee rates configured yet. Add your first rate above.</p>
        ) : (
          <div className="divide-y rounded-md border">
            {(fees || []).map((fee) => (
              <div key={fee.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">
                      {SERVICE_TYPES.find((s) => s.value === fee.service_type)?.label || fee.service_type}
                    </Badge>
                    <span className="text-sm font-medium capitalize">{fee.trade_type}</span>
                    {fee.county && <span className="text-xs text-muted-foreground">· {fee.county}</span>}
                    {!fee.is_active && <Badge variant="outline" className="text-[9px] text-muted-foreground">Inactive</Badge>}
                  </div>
                  {fee.description && <p className="text-xs text-muted-foreground mt-0.5">{fee.description}</p>}
                </div>
                <div className="flex items-center gap-3 ml-4">
                  <span className="text-sm font-semibold font-mono">${Number(fee.base_fee).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(fee)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteMutation.mutate(fee.id)} disabled={deleteMutation.isPending}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
