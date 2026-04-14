import { useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useProjects } from "@/hooks/useProjects";
import { useReviewFlags } from "@/hooks/useReviewData";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SeverityBadge from "@/components/shared/SeverityBadge";
import ConfidenceBadge from "@/components/shared/ConfidenceBadge";
import { ArrowLeft, Check, X, Pencil, ZoomIn, ZoomOut, Maximize } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

// Generate annotation pins from real review_flags data
function flagsToPins(flags: any[]) {
  // Use a deterministic pseudo-random layout based on flag id hash
  return flags
    .filter((f) => f.status === "active")
    .map((f, i) => {
      // Use characters from the UUID to place pins deterministically across the sheet
      const hash = f.id.replace(/-/g, "");
      const x = (parseInt(hash.slice(0, 4), 16) % 70) + 10; // 10-80%
      const y = (parseInt(hash.slice(4, 8), 16) % 70) + 10; // 10-80%
      return { id: i + 1, flagId: f.id, x, y, severity: f.severity || "admin" };
    });
}

const pinColor: Record<string, string> = {
  critical: "#D63230", major: "#E8831A", minor: "#D4A017", admin: "#5B8DB8",
};

export default function ReviewDetail() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: projects } = useProjects();
  const { data: flags, isLoading } = useReviewFlags(projectId);

  const project = projects?.find((p) => p.id === projectId);

  const [severityFilter, setSeverityFilter] = useState("all");
  const [confFilter, setConfFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [selectedFlag, setSelectedFlag] = useState<any>(null);
  const [correctionForm, setCorrectionForm] = useState({ corrected_value: "", original_value: "", fbc_section: "", context_notes: "", correction_type: "override" });
  const [fieldMode, setFieldMode] = useState(() => {
    try { return localStorage.getItem("field-mode") === "true"; } catch { return false; }
  });

  const filteredFlags = useMemo(() => {
    return (flags || []).filter((f) => {
      if (severityFilter !== "all" && f.severity !== severityFilter) return false;
      if (confFilter !== "all" && f.confidence !== confFilter) return false;
      if (statusFilter === "active" && f.status !== "active") return false;
      if (statusFilter === "resolved" && f.status !== "resolved") return false;
      if (fieldMode && f.severity !== "critical" && f.severity !== "major") return false;
      return true;
    });
  }, [flags, severityFilter, confFilter, statusFilter, fieldMode]);

  const counts = useMemo(() => {
    const c = { critical: 0, major: 0, minor: 0, admin: 0, resolved: 0 };
    (flags || []).forEach((f) => {
      if (f.status === "resolved") c.resolved++;
      else if (f.severity && f.severity in c) (c as any)[f.severity]++;
    });
    return c;
  }, [flags]);

  const handleResolve = async (flagId: string) => {
    await supabase.from("review_flags").update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: user?.id }).eq("id", flagId);
    queryClient.invalidateQueries({ queryKey: ["review_flags"] });
    toast.success("Flag resolved");
  };

  const handleDismiss = async (flagId: string) => {
    await supabase.from("review_flags").update({ status: "dismissed" }).eq("id", flagId);
    queryClient.invalidateQueries({ queryKey: ["review_flags"] });
    toast.success("Flag dismissed");
  };

  const handleCorrection = async () => {
    if (!selectedFlag) return;
    const { data, error } = await supabase.from("corrections").insert({
      output_id: null,
      user_id: user?.id!,
      original_value: correctionForm.original_value || selectedFlag.description,
      corrected_value: correctionForm.corrected_value,
      correction_type: correctionForm.correction_type,
      fbc_section: correctionForm.fbc_section || selectedFlag.fbc_section,
      context_notes: correctionForm.context_notes,
    }).select("id").single();
    if (error) { toast.error("Failed to save correction"); return; }
    
    // Trigger embedding generation via edge function
    supabase.functions.invoke("process-correction", {
      body: { correction_id: data.id },
    }).catch(() => { /* non-blocking */ });
    
    toast.success("Correction saved — this feeds the AI learning system");
    setCorrectionOpen(false);
    setCorrectionForm({ corrected_value: "", original_value: "", fbc_section: "", context_notes: "", correction_type: "override" });
  };

  return (
    <div className="page-enter flex flex-col h-[calc(100vh-56px)]">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b bg-card h-12 shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/review")} className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="font-mono text-sm text-fpp-gray-600">{project?.name || "Project"}</span>
          <span className="text-xs text-fpp-gray-400">{project?.county}</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-fpp-gray-600">
            <input
              type="checkbox"
              checked={fieldMode}
              onChange={(e) => { setFieldMode(e.target.checked); localStorage.setItem("field-mode", String(e.target.checked)); }}
              className="rounded"
            />
            Field Mode
          </label>
        </div>
      </div>

      {/* Main area */}
      <div className="flex flex-1 min-h-0">
        {/* Left - Plan viewer */}
        <div className="hidden md:flex w-[60%] bg-fpp-navy-mid relative flex-col">
           <div className="flex-1 relative flex items-center justify-center">
             <p className="text-fpp-gray-400 text-lg opacity-30">Plan Sheet Viewer</p>
             {/* Pins from real flags */}
             {flagsToPins(flags || []).map((pin) => (
               <div
                 key={pin.id}
                 className="absolute flex items-center justify-center h-7 w-7 rounded-full border-2 border-white shadow-lg cursor-pointer hover:scale-110 transition-transform"
                 style={{ left: `${pin.x}%`, top: `${pin.y}%`, backgroundColor: pinColor[pin.severity] }}
               >
                 <span className="text-white font-mono text-[10px] font-medium">{pin.id}</span>
               </div>
             ))}
          </div>
          <div className="absolute top-3 right-3 flex gap-1">
            <Button variant="secondary" size="icon" className="h-7 w-7"><ZoomIn className="h-3.5 w-3.5" /></Button>
            <Button variant="secondary" size="icon" className="h-7 w-7"><ZoomOut className="h-3.5 w-3.5" /></Button>
            <Button variant="secondary" size="icon" className="h-7 w-7"><Maximize className="h-3.5 w-3.5" /></Button>
          </div>
        </div>

        {/* Right - Flags panel */}
        <div className="flex-1 md:w-[40%] flex flex-col border-l bg-card">
          {/* Summary bar */}
          <div className="flex items-center gap-2 p-3 border-b flex-wrap">
            <SeverityBadge level="critical" count={counts.critical} />
            <SeverityBadge level="major" count={counts.major} />
            <SeverityBadge level="minor" count={counts.minor} />
            <SeverityBadge level="admin" count={counts.admin} />
            <SeverityBadge level="pass" count={counts.resolved} />
          </div>

          <Tabs defaultValue="flags" className="flex-1 flex flex-col">
            <TabsList className="mx-3 mt-2">
              <TabsTrigger value="flags">Flags ({(flags || []).filter(f => f.status === "active").length})</TabsTrigger>
              <TabsTrigger value="fbc">FBC Reference</TabsTrigger>
              <TabsTrigger value="notes">Notes</TabsTrigger>
            </TabsList>

            <TabsContent value="flags" className="flex-1 overflow-auto px-3 pb-3 mt-0">
              {/* Filters */}
              <div className="flex gap-2 py-2 flex-wrap">
                <Select value={severityFilter} onValueChange={setSeverityFilter}>
                  <SelectTrigger className="h-7 text-xs w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Severity</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="major">Major</SelectItem>
                    <SelectItem value="minor">Minor</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={confFilter} onValueChange={setConfFilter}>
                  <SelectTrigger className="h-7 text-xs w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Confidence</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex gap-0.5 bg-muted rounded p-0.5">
                  <button onClick={() => setStatusFilter("active")} className={`px-2 py-0.5 rounded text-xs ${statusFilter === "active" ? "bg-card shadow-sm font-medium" : "text-fpp-gray-400"}`}>Active</button>
                  <button onClick={() => setStatusFilter("resolved")} className={`px-2 py-0.5 rounded text-xs ${statusFilter === "resolved" ? "bg-card shadow-sm font-medium" : "text-fpp-gray-400"}`}>Resolved</button>
                </div>
              </div>

              {/* Flag cards */}
              <div className="space-y-2">
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 rounded bg-muted animate-pulse" />)
                ) : filteredFlags.length === 0 ? (
                  <p className="text-sm text-fpp-gray-400 text-center py-8">No flags matching filters</p>
                ) : (
                  filteredFlags.map((flag) => (
                    <div
                      key={flag.id}
                      className={`bg-card border rounded-r-md p-4 border-l-4 transition-opacity ${flag.status === "resolved" ? "opacity-50" : ""}`}
                      style={{ borderLeftColor: pinColor[flag.severity || "admin"] }}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <SeverityBadge level={(flag.severity as any) || "admin"} />
                        <ConfidenceBadge level={(flag.confidence as any) || "medium"} />
                      </div>
                      <p className="text-sm font-semibold text-foreground">{flag.description?.slice(0, 80) || "Review flag"}</p>
                      <p className="text-xs text-fpp-gray-400 font-mono mt-0.5">
                        {flag.sheet_ref && `Sheet ${flag.sheet_ref}`}{flag.detail_ref && ` · Detail ${flag.detail_ref}`}
                      </p>
                      {flag.fbc_section && (
                        <span className="inline-block mt-1.5 text-xs font-mono bg-muted px-2 py-0.5 rounded border">
                          FBC {flag.fbc_section}
                        </span>
                      )}
                      {flag.status !== "resolved" && (
                        <div className="flex items-center gap-1.5 mt-3">
                          <Button size="sm" variant="default" className="h-7 text-xs" onClick={() => handleResolve(flag.id)}>
                            <Check className="h-3 w-3 mr-1" /> Resolve
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleDismiss(flag.id)}>
                            <X className="h-3 w-3 mr-1" /> Dismiss
                          </Button>
                          <Button
                            size="sm" variant="outline" className="h-7 text-xs"
                            onClick={() => { setSelectedFlag(flag); setCorrectionOpen(true); }}
                          >
                            <Pencil className="h-3 w-3 mr-1" /> Correct
                          </Button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </TabsContent>

            <TabsContent value="fbc" className="flex-1 overflow-auto px-3 pb-3 mt-0">
              <div className="py-8 text-center text-fpp-gray-400 text-sm">
                <p>Click an FBC citation from a flag card to view the reference here.</p>
              </div>
            </TabsContent>

            <TabsContent value="notes" className="flex-1 overflow-auto px-3 pb-3 mt-0">
              <Textarea
                className="h-full min-h-[200px] mt-2"
                placeholder="Add reviewer notes for this project..."
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="flex items-center justify-between px-4 py-2 border-t bg-card h-12 shrink-0">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="text-xs">← Previous Sheet</Button>
          <span className="text-xs text-fpp-gray-400 font-mono">Sheet 1 of 6</span>
          <Button variant="ghost" size="sm" className="text-xs">Next Sheet →</Button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-fpp-gray-600">
            {counts.resolved} of {(flags || []).length} flags addressed
          </span>
          <Button size="sm" className="text-xs">Generate Comment Letter</Button>
        </div>
      </div>

      {/* Correction modal */}
      <Dialog open={correctionOpen} onOpenChange={setCorrectionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Correct AI Flag</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">What did the AI get wrong?</Label>
              <Textarea value={correctionForm.original_value} onChange={(e) => setCorrectionForm(prev => ({ ...prev, original_value: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Correct finding</Label>
              <Textarea value={correctionForm.corrected_value} onChange={(e) => setCorrectionForm(prev => ({ ...prev, corrected_value: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">FBC Section (if different)</Label>
              <Input value={correctionForm.fbc_section} onChange={(e) => setCorrectionForm(prev => ({ ...prev, fbc_section: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Notes for future reference</Label>
              <Textarea value={correctionForm.context_notes} onChange={(e) => setCorrectionForm(prev => ({ ...prev, context_notes: e.target.value }))} />
            </div>
            <RadioGroup value={correctionForm.correction_type} onValueChange={(v) => setCorrectionForm(prev => ({ ...prev, correction_type: v }))}>
              <div className="flex items-center gap-2"><RadioGroupItem value="override" id="r1" /><Label htmlFor="r1" className="text-xs">Override (AI was wrong)</Label></div>
              <div className="flex items-center gap-2"><RadioGroupItem value="edit" id="r2" /><Label htmlFor="r2" className="text-xs">Edit (partially correct)</Label></div>
              <div className="flex items-center gap-2"><RadioGroupItem value="flag" id="r3" /><Label htmlFor="r3" className="text-xs">Flag (missed this issue)</Label></div>
            </RadioGroup>
            <Button onClick={handleCorrection} className="w-full">Submit Correction</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
