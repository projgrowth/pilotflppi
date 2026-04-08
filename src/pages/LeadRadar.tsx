import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { callAI } from "@/lib/ai";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Radar, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface PermitLead {
  id: string;
  address: string;
  county: string;
  contractor_name: string | null;
  permit_type: string;
  project_value: number | null;
  outreach_status: string;
  detected_at: string;
}

function usePermitLeads() {
  return useQuery({
    queryKey: ["permit-leads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("permit_leads")
        .select("*")
        .order("detected_at", { ascending: false });
      if (error) throw error;
      return data as PermitLead[];
    },
  });
}

const statusColors: Record<string, string> = {
  new: "bg-accent/10 text-accent",
  contacted: "bg-teal/10 text-teal",
  responded: "bg-success/10 text-success",
  converted: "bg-success/10 text-success",
  declined: "bg-muted text-muted-foreground",
};

function formatValue(v: number | null) {
  if (!v) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v}`;
}

export default function LeadRadar() {
  const { data: leads, isLoading } = usePermitLeads();
  const queryClient = useQueryClient();
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const [emailContent, setEmailContent] = useState("");
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);

  const generateOutreach = async (lead: PermitLead) => {
    setGeneratingFor(lead.id);
    try {
      const result = await callAI({
        action: "generate_outreach_email",
        payload: {
          address: lead.address,
          county: lead.county,
          contractor_name: lead.contractor_name,
          permit_type: lead.permit_type,
          project_value: lead.project_value,
        },
      });
      setEmailContent(result);
      setEmailDialogOpen(true);

      // Update outreach status
      if (lead.outreach_status === "new") {
        await supabase.from("permit_leads").update({ outreach_status: "contacted" }).eq("id", lead.id);
        queryClient.invalidateQueries({ queryKey: ["permit-leads"] });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate outreach");
    } finally {
      setGeneratingFor(null);
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl">
      <h1 className="text-2xl font-medium mb-6">Lead Radar</h1>

      <Card className="shadow-subtle border">
        {isLoading ? (
          <div className="divide-y">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4">
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-48 rounded bg-muted animate-pulse" />
                  <div className="h-3 w-32 rounded bg-muted animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : (leads || []).length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Radar className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <h3 className="text-sm font-medium">No permit leads detected</h3>
            <p className="text-xs text-muted-foreground mt-1">New leads will appear here as permits are detected</p>
          </div>
        ) : (
          <div className="divide-y">
            {(leads || []).map((lead) => (
              <div key={lead.id} className="flex items-center gap-4 px-5 py-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{lead.address}</p>
                  <p className="text-xs text-muted-foreground">{lead.contractor_name || "Unknown contractor"}</p>
                </div>
                <span className="hidden sm:inline-flex rounded bg-muted px-2 py-0.5 text-[10px] font-medium capitalize">
                  {lead.permit_type.replace(/_/g, " ")}
                </span>
                <span className="hidden md:inline text-xs text-muted-foreground">{lead.county}</span>
                <span className="hidden lg:inline text-sm font-mono">{formatValue(lead.project_value)}</span>
                <span className="text-xs text-muted-foreground">{format(new Date(lead.detected_at), "MMM d")}</span>
                <span className={cn("rounded px-2 py-0.5 text-[10px] font-medium capitalize", statusColors[lead.outreach_status] || "bg-muted text-muted-foreground")}>
                  {lead.outreach_status}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => generateOutreach(lead)}
                  disabled={generatingFor === lead.id}
                >
                  {generatingFor === lead.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    "Generate Outreach"
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Email preview */}
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
