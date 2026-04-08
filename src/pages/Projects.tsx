import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { StatusChip } from "@/components/StatusChip";
import { DeadlineRing } from "@/components/DeadlineRing";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { useProjects, getDaysElapsed, getDaysRemaining } from "@/hooks/useProjects";
import { useContractors } from "@/hooks/useContractors";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Search, ChevronRight, FolderKanban, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const filters = ["All", "Plan Review", "Inspection", "Pending", "Complete"] as const;

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

export default function Projects() {
  const [activeFilter, setActiveFilter] = useState<typeof filters[number]>("All");
  const [search, setSearch] = useState("");
  const { data: projects, isLoading } = useProjects();
  const { data: contractors } = useContractors();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [county, setCounty] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [tradeType, setTradeType] = useState("building");
  const [contractorId, setContractorId] = useState("");

  useEffect(() => {
    if (searchParams.get("action") === "new") {
      setDialogOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const resetForm = () => {
    setName(""); setAddress(""); setCounty(""); setJurisdiction(""); setTradeType("building"); setContractorId("");
  };

  const handleCreate = async () => {
    if (!name.trim() || !address.trim()) {
      toast.error("Name and address are required");
      return;
    }
    setSaving(true);
    try {
      const deadlineAt = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("projects")
        .insert({
          name: name.trim(),
          address: address.trim(),
          county: county || "",
          jurisdiction: jurisdiction || "",
          trade_type: tradeType,
          contractor_id: contractorId || null,
          status: "intake" as const,
          notice_filed_at: new Date().toISOString(),
          deadline_at: deadlineAt,
          services: ["plan_review"],
        })
        .select("id")
        .single();
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project created");
      setDialogOpen(false);
      resetForm();
      navigate(`/projects/${data.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setSaving(false);
    }
  };

  const filtered = (projects || []).filter((p) => {
    if (search) {
      const q = search.toLowerCase();
      if (!p.name.toLowerCase().includes(q) && !p.address.toLowerCase().includes(q)) return false;
    }
    if (activeFilter === "All") return true;
    if (activeFilter === "Plan Review") return p.status === "plan_review" || p.status === "comments_sent" || p.status === "resubmitted";
    if (activeFilter === "Inspection") return p.status === "inspection_scheduled" || p.status === "inspection_complete";
    if (activeFilter === "Pending") return p.status === "intake" || p.status === "on_hold";
    if (activeFilter === "Complete") return p.status === "approved" || p.status === "certificate_issued" || p.status === "permit_issued";
    return true;
  });

  return (
    <div className="p-6 md:p-8 max-w-7xl">
      <PageHeader
        title="Projects"
        actions={
          <Button className="bg-accent text-accent-foreground hover:bg-accent/90" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> New Project
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className="flex gap-1 rounded-lg bg-muted/50 p-1">
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={cn(
                "px-3 py-1.5 text-sm rounded-md transition-all duration-150",
                activeFilter === f
                  ? "bg-background text-foreground font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search projects..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 w-64" />
        </div>
      </div>

      <Card className="shadow-subtle border">
        {isLoading ? (
          <div className="divide-y">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-3.5">
                <div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-48 rounded bg-muted animate-pulse" />
                  <div className="h-3 w-64 rounded bg-muted animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title="No projects found"
            description="Try adjusting your filters or search"
          />
        ) : (
          <div className="divide-y">
            {/* Column headers */}
            <div className="hidden md:grid grid-cols-[40px_1fr_100px_80px_80px_120px_80px_20px] gap-4 px-5 py-2.5 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold border-b bg-muted/30">
              <span />
              <span>Project</span>
              <span>Contractor</span>
              <span>Trade</span>
              <span>County</span>
              <span>Status</span>
              <span>Deadline</span>
              <span />
            </div>
            {filtered.map((project) => {
              const daysElapsed = getDaysElapsed(project.notice_filed_at);
              const remaining = getDaysRemaining(project.deadline_at);
              return (
                <div
                  key={project.id}
                  onClick={() => navigate(`/projects/${project.id}`)}
                  className="list-row"
                >
                  <DeadlineRing daysElapsed={daysElapsed} size={40} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{project.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{project.address}</p>
                  </div>
                  <span className="hidden sm:inline text-xs text-muted-foreground truncate">
                    {project.contractor?.name || "—"}
                  </span>
                  <span className="hidden md:inline-flex rounded bg-muted px-2 py-0.5 text-[10px] font-medium capitalize">
                    {project.trade_type}
                  </span>
                  <span className="hidden lg:inline text-xs text-muted-foreground">{project.county}</span>
                  <StatusChip status={project.status} />
                  <span className={cn(
                    "font-mono text-xs whitespace-nowrap",
                    remaining <= 0 ? "text-destructive" : remaining <= 3 ? "text-destructive" : remaining <= 6 ? "text-warning" : "text-muted-foreground"
                  )}>
                    {remaining <= 0 ? "Overdue" : `${remaining}d left`}
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* New Project Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Project</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Project Name *</Label>
              <Input placeholder="Oceanview Residences" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Address *</Label>
              <Input placeholder="123 Main St, Miami, FL 33131" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>County</Label>
                <Select value={county} onValueChange={setCounty}>
                  <SelectTrigger><SelectValue placeholder="Select county" /></SelectTrigger>
                  <SelectContent>
                    {FLORIDA_COUNTIES.map((c) => (
                      <SelectItem key={c} value={c}>{c.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Jurisdiction</Label>
                <Input placeholder="City of Miami" value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
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
              <div className="space-y-2">
                <Label>Contractor</Label>
                <Select value={contractorId} onValueChange={setContractorId}>
                  <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                  <SelectContent>
                    {(contractors || []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }}>Cancel</Button>
            <Button
              className="bg-accent text-accent-foreground hover:bg-accent/90"
              onClick={handleCreate}
              disabled={saving || !name.trim() || !address.trim()}
            >
              {saving ? "Creating..." : "Create Project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
