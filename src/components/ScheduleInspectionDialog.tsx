import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useProjects } from "@/hooks/useProjects";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-fill with a specific project */
  projectId?: string;
}

const INSPECTION_TYPES = ["general", "building", "electrical", "plumbing", "mechanical", "roofing", "fire", "final"];

export function ScheduleInspectionDialog({ open, onOpenChange, projectId }: Props) {
  const queryClient = useQueryClient();
  const { data: projects } = useProjects();
  const [selectedProject, setSelectedProject] = useState(projectId || "");
  const [inspectionType, setInspectionType] = useState("general");
  const [scheduledAt, setScheduledAt] = useState("");
  const [isVirtual, setIsVirtual] = useState(true);
  const [videoCallUrl, setVideoCallUrl] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset when dialog opens
  const handleOpenChange = (v: boolean) => {
    if (v) {
      setSelectedProject(projectId || "");
      setInspectionType("general");
      setScheduledAt("");
      setIsVirtual(true);
      setVideoCallUrl("");
    }
    onOpenChange(v);
  };

  const handleSubmit = async () => {
    if (!selectedProject) { toast.error("Select a project"); return; }
    if (!scheduledAt) { toast.error("Select a date and time"); return; }

    setSaving(true);
    try {
      const { error } = await supabase.from("inspections").insert({
        project_id: selectedProject,
        inspection_type: inspectionType,
        scheduled_at: new Date(scheduledAt).toISOString(),
        virtual: isVirtual,
        video_call_url: isVirtual && videoCallUrl ? videoCallUrl : null,
      });
      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ["inspections"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Inspection scheduled");
      handleOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to schedule");
    } finally {
      setSaving(false);
    }
  };

  const activeProjects = (projects || []).filter(
    (p) => !["certificate_issued", "cancelled"].includes(p.status)
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Schedule Inspection</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {!projectId && (
            <div className="space-y-2">
              <Label>Project</Label>
              <Select value={selectedProject} onValueChange={setSelectedProject}>
                <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                <SelectContent>
                  {activeProjects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label>Inspection Type</Label>
            <Select value={inspectionType} onValueChange={setInspectionType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {INSPECTION_TYPES.map((t) => (
                  <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Date & Time</Label>
            <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </div>
          <div className="flex items-center justify-between">
            <Label>Virtual Inspection</Label>
            <Switch checked={isVirtual} onCheckedChange={setIsVirtual} />
          </div>
          {isVirtual && (
            <div className="space-y-2">
              <Label>Video Call URL (optional)</Label>
              <Input placeholder="https://meet.google.com/..." value={videoCallUrl} onChange={(e) => setVideoCallUrl(e.target.value)} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving} className="bg-accent text-accent-foreground hover:bg-accent/90">
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Scheduling...</> : "Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
