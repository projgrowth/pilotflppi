import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { callAI } from "@/lib/ai";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Building2, Mail, Phone, Loader2, AlertTriangle, Clock, CheckCircle2 } from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface MilestoneBuilding {
  id: string;
  building_name: string;
  address: string;
  stories: number;
  co_issued_date: string | null;
  milestone_deadline: string | null;
  status: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
}

function useMilestoneBuildings() {
  return useQuery({
    queryKey: ["milestone-buildings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("milestone_buildings")
        .select("*")
        .order("milestone_deadline", { ascending: true });
      if (error) throw error;
      return data as MilestoneBuilding[];
    },
  });
}

function getStatusInfo(building: MilestoneBuilding) {
  if (!building.milestone_deadline) return { color: "bg-muted text-muted-foreground", label: "No deadline", icon: Clock };
  const days = differenceInDays(new Date(building.milestone_deadline), new Date());
  if (days < 0) return { color: "bg-destructive/10 text-destructive", label: "Overdue", icon: AlertTriangle };
  if (days <= 90) return { color: "bg-warning/10 text-warning", label: `${days}d remaining`, icon: Clock };
  return { color: "bg-muted text-muted-foreground", label: `${days}d remaining`, icon: CheckCircle2 };
}

export default function MilestoneRadar() {
  const { data: buildings, isLoading } = useMilestoneBuildings();
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const [emailContent, setEmailContent] = useState("");
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);

  const launchOutreach = async (building: MilestoneBuilding) => {
    setGeneratingFor(building.id);
    try {
      const result = await callAI({
        action: "generate_milestone_outreach",
        payload: {
          building_name: building.building_name,
          address: building.address,
          stories: building.stories,
          co_issued_date: building.co_issued_date,
          milestone_deadline: building.milestone_deadline,
          status: building.status,
          contact_name: building.contact_name,
          contact_email: building.contact_email,
        },
      });
      setEmailContent(result);
      setEmailDialogOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate outreach");
    } finally {
      setGeneratingFor(null);
    }
  };

  return (
    <div className="p-8 md:p-10 max-w-7xl">
      <PageHeader title="Milestone Radar" subtitle="Track building milestone inspection deadlines" />

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-48 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : (buildings || []).length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No milestone buildings tracked"
          description="Add buildings to monitor their milestone inspection deadlines"
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(buildings || []).map((b) => {
            const status = getStatusInfo(b);
            const StatusIcon = status.icon;
            return (
              <Card key={b.id} className={cn("shadow-subtle", b.status === "overdue" && "border-destructive/30")}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-sm font-medium">{b.building_name}</h3>
                      <p className="text-xs text-muted-foreground">{b.address}</p>
                    </div>
                    <span className={cn("inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium", status.color)}>
                      <StatusIcon className="h-3 w-3" />
                      {status.label}
                    </span>
                  </div>

                  <div className="text-xs text-muted-foreground space-y-1 mb-3">
                    <p>{b.stories} stories · CO issued {b.co_issued_date ? format(new Date(b.co_issued_date), "MMM yyyy") : "N/A"}</p>
                    <p>Milestone deadline: {b.milestone_deadline ? format(new Date(b.milestone_deadline), "MMM d, yyyy") : "Not set"}</p>
                  </div>

                  {(b.contact_name || b.contact_email || b.contact_phone) && (
                    <div className="text-xs text-muted-foreground space-y-0.5 mb-4 border-t pt-2">
                      {b.contact_name && <p className="font-medium text-foreground">{b.contact_name}</p>}
                      {b.contact_email && (
                        <p className="flex items-center gap-1"><Mail className="h-3 w-3" />{b.contact_email}</p>
                      )}
                      {b.contact_phone && (
                        <p className="flex items-center gap-1"><Phone className="h-3 w-3" />{b.contact_phone}</p>
                      )}
                    </div>
                  )}

                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => launchOutreach(b)}
                    disabled={generatingFor === b.id}
                  >
                    {generatingFor === b.id ? (
                      <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Generating...</>
                    ) : (
                      "Launch Outreach"
                    )}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Outreach Email Preview</DialogTitle>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/30 p-4 text-sm whitespace-pre-wrap max-h-96 overflow-y-auto">
            {emailContent}
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setEmailDialogOpen(false)}>Close</Button>
            <Button className="bg-accent text-accent-foreground hover:bg-accent/90" onClick={() => { navigator.clipboard.writeText(emailContent); toast.success("Copied to clipboard"); }}>
              Copy Email
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
