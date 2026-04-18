import { useState } from "react";
import { useContractors } from "@/hooks/useContractors";
import { useProjects } from "@/hooks/useProjects";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Users, Pencil, Trash2, ChevronRight, FolderKanban, AlertTriangle } from "lucide-react";
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
 const { data: projects } = useProjects();
 const queryClient = useQueryClient();
 const navigate = useNavigate();
 const [dialogOpen, setDialogOpen] = useState(false);
 const [editingId, setEditingId] = useState<string | null>(null);
 const [expandedId, setExpandedId] = useState<string | null>(null);
 const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

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

 const getLinkedProjects = (contractorId: string) =>
 (projects || []).filter((p) => p.contractor_id === contractorId);

 const confirmDelete = async () => {
 if (!deleteTarget) return;
 const { error } = await supabase.from("contractors").delete().eq("id", deleteTarget.id);
 if (error) { toast.error(error.message); return; }
 toast.success("Contractor deleted");
 queryClient.invalidateQueries({ queryKey: ["contractors"] });
 setDeleteTarget(null);
 };

 return (
 <div className="p-8 md:p-10 max-w-7xl">
 <PageHeader
 title="Contractors"
 actions={
 <Button onClick={openAdd}>+ Add Contractor</Button>
 }
 />

 <Card className="shadow-subtle">
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
 <EmptyState
 icon={Users}
 title="No contractors yet"
 description="Add your first contractor to get started"
 actionLabel="Add Contractor"
 onAction={openAdd}
 />
 ) : (
 <>
 {/* Column headers */}
 <div className="hidden md:grid grid-cols-[40px_1fr_140px_140px_100px_80px_80px] gap-4 px-5 py-3 text-[11px] uppercase tracking-widest text-muted-foreground font-semibold border-b bg-muted/20">
 <span />
 <span>Company</span>
 <span>Email</span>
 <span>Phone</span>
 <span>Portal</span>
 <span />
 <span />
 </div>
 <div className="divide-y">
 {(contractors || []).map((c) => {
 const linked = getLinkedProjects(c.id);
 const isExpanded = expandedId === c.id;
 return (
 <div key={c.id}>
 <div
 className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-muted/30 transition-colors"
 onClick={() => setExpandedId(isExpanded ? null : c.id)}
 >
 <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground shrink-0">
 {c.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
 </div>
 <div className="flex-1 min-w-0">
 <p className="text-sm font-medium truncate">{c.name}</p>
 <p className="text-xs text-muted-foreground font-mono">{c.license_number || "No license"}</p>
 </div>
 <span className="hidden sm:inline text-xs text-muted-foreground truncate max-w-[140px]">{c.email || "—"}</span>
 <span className="hidden md:inline text-xs text-muted-foreground">{c.phone || "—"}</span>
 <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
 <span className="text-[10px] text-muted-foreground">Portal</span>
 <Switch checked={c.portal_access} onCheckedChange={() => togglePortal(c.id, c.portal_access)} />
 </div>
 <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); openEdit(c); }}>
 <Pencil className="h-3.5 w-3.5" />
 </Button>
 <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: c.id, name: c.name }); }}>
 <Trash2 className="h-3.5 w-3.5" />
 </Button>
 <ChevronRight className={`h-4 w-4 text-muted-foreground/40 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
 </div>
 {/* Expanded: linked projects */}
 {isExpanded && (
 <div className="px-5 pb-4 pl-[72px]">
 <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
 Linked Projects ({linked.length})
 </p>
 {linked.length === 0 ? (
 <p className="text-xs text-muted-foreground">No projects linked to this contractor</p>
 ) : (
 <div className="space-y-1">
 {linked.map((p) => (
 <div
 key={p.id}
 onClick={() => navigate(`/projects/${p.id}`)}
 className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-muted/40 cursor-pointer transition-colors"
 >
 <FolderKanban className="h-3.5 w-3.5 text-muted-foreground" />
 <span className="text-sm truncate flex-1">{p.name}</span>
 <span className="text-[10px] text-muted-foreground capitalize">{p.status.replace(/_/g, " ")}</span>
 </div>
 ))}
 </div>
 )}
 </div>
 )}
 </div>
 );
 })}
 </div>
 </>
 )}
 </Card>

 {/* Add/Edit dialog */}
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
 <Button type="submit" >
 {editingId ? "Save Changes" : "Add Contractor"}
 </Button>
 </DialogFooter>
 </form>
 </Form>
 </DialogContent>
 </Dialog>

 {/* Delete confirmation dialog */}
 <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
 <DialogContent className="sm:max-w-sm">
 <DialogHeader>
 <DialogTitle className="flex items-center gap-2">
 <AlertTriangle className="h-4 w-4 text-destructive" /> Delete Contractor
 </DialogTitle>
 <DialogDescription>
 {deleteTarget && (() => {
 const linked = getLinkedProjects(deleteTarget.id);
 return linked.length > 0
 ? `"${deleteTarget.name}" is linked to ${linked.length} project${linked.length > 1 ? "s" : ""}. Deleting will remove this association.`
 : `Are you sure you want to delete "${deleteTarget.name}"?`;
 })()}
 </DialogDescription>
 </DialogHeader>
 <DialogFooter>
 <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
 <Button variant="destructive" onClick={confirmDelete}>Delete</Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 </div>
 );
}
