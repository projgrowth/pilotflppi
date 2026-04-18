import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useContractors } from "@/hooks/useContractors";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Project } from "@/hooks/useProjects";

interface Props {
 open: boolean;
 onOpenChange: (open: boolean) => void;
 project: Project;
}

const FLORIDA_COUNTIES = [
 "miami-dade", "broward", "palm-beach", "hillsborough", "orange", "duval",
 "pinellas", "lee", "brevard", "volusia", "sarasota", "manatee", "collier",
 "polk", "seminole", "pasco", "osceola", "st-lucie", "escambia", "marion",
];

const TRADE_TYPES = [
 { value: "building", label: "Building (General)" },
 { value: "structural", label: "Structural" },
 { value: "mechanical", label: "Mechanical" },
 { value: "electrical", label: "Electrical" },
 { value: "plumbing", label: "Plumbing" },
 { value: "roofing", label: "Roofing" },
 { value: "fire", label: "Fire Protection" },
];

export function EditProjectDialog({ open, onOpenChange, project }: Props) {
 const queryClient = useQueryClient();
 const { data: contractors } = useContractors();
 const [name, setName] = useState(project.name);
 const [address, setAddress] = useState(project.address);
 const [county, setCounty] = useState(project.county);
 const [jurisdiction, setJurisdiction] = useState(project.jurisdiction);
 const [tradeType, setTradeType] = useState(project.trade_type);
 const [contractorId, setContractorId] = useState(project.contractor_id || "none");
 const [saving, setSaving] = useState(false);

 useEffect(() => {
 if (open) {
 setName(project.name);
 setAddress(project.address);
 setCounty(project.county);
 setJurisdiction(project.jurisdiction);
 setTradeType(project.trade_type);
 setContractorId(project.contractor_id || "none");
 }
 }, [open, project]);

 const handleSave = async () => {
 if (!name.trim()) { toast.error("Name is required"); return; }
 setSaving(true);
 try {
 const { error } = await supabase
 .from("projects")
 .update({
 name: name.trim(),
 address: address.trim(),
 county,
 jurisdiction: jurisdiction.trim(),
 trade_type: tradeType,
 contractor_id: contractorId === "none" ? null : contractorId,
 })
 .eq("id", project.id);
 if (error) throw error;
 queryClient.invalidateQueries({ queryKey: ["project", project.id] });
 queryClient.invalidateQueries({ queryKey: ["projects"] });
 toast.success("Project updated");
 onOpenChange(false);
 } catch (err) {
 toast.error(err instanceof Error ? err.message : "Failed to save");
 } finally {
 setSaving(false);
 }
 };

 return (
 <Dialog open={open} onOpenChange={onOpenChange}>
 <DialogContent className="sm:max-w-md">
 <DialogHeader>
 <DialogTitle>Edit Project</DialogTitle>
 </DialogHeader>
 <div className="space-y-4">
 <div className="space-y-2">
 <Label>Project Name</Label>
 <Input value={name} onChange={(e) => setName(e.target.value)} />
 </div>
 <div className="space-y-2">
 <Label>Address</Label>
 <Input value={address} onChange={(e) => setAddress(e.target.value)} />
 </div>
 <div className="grid grid-cols-2 gap-4">
 <div className="space-y-2">
 <Label>County</Label>
 <Select value={county} onValueChange={setCounty}>
 <SelectTrigger><SelectValue /></SelectTrigger>
 <SelectContent>
 {FLORIDA_COUNTIES.map((c) => (
 <SelectItem key={c} value={c} className="capitalize">{c.replace(/-/g, " ")}</SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 <div className="space-y-2">
 <Label>Trade Type</Label>
 <Select value={tradeType} onValueChange={setTradeType}>
 <SelectTrigger><SelectValue /></SelectTrigger>
 <SelectContent>
 {TRADE_TYPES.map((t) => (
 <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 </div>
 <div className="space-y-2">
 <Label>Jurisdiction</Label>
 <Input value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} placeholder="City of..." />
 </div>
 <div className="space-y-2">
 <Label>Contractor</Label>
 <Select value={contractorId} onValueChange={setContractorId}>
 <SelectTrigger><SelectValue placeholder="Select contractor" /></SelectTrigger>
 <SelectContent>
 <SelectItem value="none">No contractor</SelectItem>
 {(contractors || []).map((c) => (
 <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 </div>
 <DialogFooter>
 <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
 <Button onClick={handleSave} disabled={saving} >
 {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</> : "Save Changes"}
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 );
}
