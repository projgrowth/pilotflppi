import { useState } from "react";
import { useContractors } from "@/hooks/useContractors";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Users, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

const contractorSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  license_number: z.string().trim().max(50).optional().or(z.literal("")),
  email: z.string().trim().email("Invalid email").max(255).optional().or(z.literal("")),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
});

type ContractorForm = z.infer<typeof contractorSchema>;

export default function Contractors() {
  const { data: contractors, isLoading } = useContractors();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const form = useForm<ContractorForm>({
    resolver: zodResolver(contractorSchema),
    defaultValues: { name: "", license_number: "", email: "", phone: "" },
  });

  const openAdd = () => {
    setEditingId(null);
    form.reset({ name: "", license_number: "", email: "", phone: "" });
    setDialogOpen(true);
  };

  const openEdit = (c: { id: string; name: string; license_number: string | null; email: string | null; phone: string | null }) => {
    setEditingId(c.id);
    form.reset({
      name: c.name,
      license_number: c.license_number || "",
      email: c.email || "",
      phone: c.phone || "",
    });
    setDialogOpen(true);
  };

  const onSubmit = async (values: ContractorForm) => {
    const payload = {
      name: values.name,
      license_number: values.license_number || null,
      email: values.email || null,
      phone: values.phone || null,
    };

    if (editingId) {
      const { error } = await supabase.from("contractors").update(payload).eq("id", editingId);
      if (error) { toast.error(error.message); return; }
      toast.success("Contractor updated");
    } else {
      const { error } = await supabase.from("contractors").insert(payload);
      if (error) { toast.error(error.message); return; }
      toast.success("Contractor added");
    }
    queryClient.invalidateQueries({ queryKey: ["contractors"] });
    setDialogOpen(false);
  };

  const togglePortal = async (id: string, current: boolean) => {
    const { error } = await supabase.from("contractors").update({ portal_access: !current }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    queryClient.invalidateQueries({ queryKey: ["contractors"] });
  };

  const deleteContractor = async (id: string) => {
    const { error } = await supabase.from("contractors").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Contractor deleted");
    queryClient.invalidateQueries({ queryKey: ["contractors"] });
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-medium">Contractors</h1>
        <Button className="bg-accent text-accent-foreground hover:bg-accent/90" onClick={openAdd}>+ Add Contractor</Button>
      </div>

      <Card className="shadow-subtle border">
        {isLoading ? (
          <div className="divide-y">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4">
                <div className="h-9 w-9 rounded-full bg-muted animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-40 rounded bg-muted animate-pulse" />
                  <div className="h-3 w-24 rounded bg-muted animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : (contractors || []).length === 0 ? (
          <div className="flex flex-col items-center py-16">
            <Users className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <h3 className="text-sm font-medium">No contractors yet</h3>
            <p className="text-xs text-muted-foreground mt-1">Add your first contractor to get started</p>
          </div>
        ) : (
          <div className="divide-y">
            {(contractors || []).map((c) => (
              <div key={c.id} className="flex items-center gap-4 px-5 py-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                  {c.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{c.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{c.license_number || "No license"}</p>
                </div>
                <span className="hidden sm:inline text-xs text-muted-foreground">{c.email || "—"}</span>
                <span className="hidden md:inline text-xs text-muted-foreground">{c.phone || "—"}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">Portal</span>
                  <Switch checked={c.portal_access} onCheckedChange={() => togglePortal(c.id, c.portal_access)} />
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(c)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteContractor(c.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Contractor" : "Add Contractor"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Company Name</FormLabel>
                  <FormControl><Input placeholder="Acme Construction LLC" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="license_number" render={({ field }) => (
                <FormItem>
                  <FormLabel>License Number</FormLabel>
                  <FormControl><Input placeholder="CGC1234567" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl><Input type="email" placeholder="contact@company.com" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl><Input placeholder="(305) 555-0100" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button type="submit" className="bg-accent text-accent-foreground hover:bg-accent/90">
                  {editingId ? "Save Changes" : "Add Contractor"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
