import { useState, useMemo } from "react";
import { useDeficiencies } from "@/hooks/useReviewData";
import { useProjects } from "@/hooks/useProjects";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import SeverityBadge from "@/components/shared/SeverityBadge";
import FppEmptyState from "@/components/shared/FppEmptyState";
import { Search, Copy, PlusCircle, ExternalLink, ChevronDown, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";

export default function Deficiencies() {
  const { data: deficiencies, isLoading } = useDeficiencies();
  const { data: projects } = useProjects();
  const [search, setSearch] = useState("");
  const [discipline, setDiscipline] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [buildingType, setBuildingType] = useState<"all" | "residential" | "commercial">("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [addingToReview, setAddingToReview] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return (deficiencies || []).filter((d) => {
      const q = search.toLowerCase();
      const matchSearch = !q || d.fbc_section.toLowerCase().includes(q) || d.title.toLowerCase().includes(q) || (d.description || "").toLowerCase().includes(q) || (d.standard_comment_language || "").toLowerCase().includes(q);
      const matchDisc = discipline === "all" || d.discipline === discipline;
      const matchSev = severity === "all" || d.severity === severity;
      // Simple residential/commercial filter based on FBC section prefix
      const isResidential = d.fbc_section.startsWith("R") || d.discipline === "energy";
      const matchType = buildingType === "all" || (buildingType === "residential" ? isResidential : !isResidential);
      return matchSearch && matchDisc && matchSev && matchType;
    });
  }, [deficiencies, search, discipline, severity, buildingType]);

  const handleCopy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success("Comment text copied");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleAddToReview = async (deficiency: typeof filtered[0], projectId: string) => {
    const { error } = await supabase.from("review_flags").insert({
      project_id: projectId,
      fbc_section: deficiency.fbc_section,
      description: deficiency.standard_comment_language || deficiency.description,
      severity: deficiency.severity,
      status: "active",
    });
    if (error) {
      toast.error("Failed to add flag: " + error.message);
    } else {
      toast.success(`Added FBC ${deficiency.fbc_section} to project review`);
      setAddingToReview(null);
    }
  };

  const pinColor: Record<string, string> = {
    critical: "#D63230", major: "#E8831A", minor: "#D4A017", admin: "#5B8DB8",
  };

  return (
    <div className="p-8 md:p-10 max-w-7xl mx-auto">
      <PageHeader
        title="Deficiency Library"
        subtitle="Pre-written Florida Building Code deficiencies with professional comment language."
        actions={<Badge variant="secondary" className="text-xs font-mono">{filtered.length} / {deficiencies?.length || 0}</Badge>}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-fpp-gray-400" />
          <Input placeholder="Search by code section, keyword, or trade..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={discipline} onValueChange={setDiscipline}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All Disciplines" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Disciplines</SelectItem>
            {["architectural","structural","mechanical","electrical","plumbing","energy","accessibility","general"].map(d => (
              <SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={severity} onValueChange={setSeverity}>
          <SelectTrigger className="w-36"><SelectValue placeholder="All Severity" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severity</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="major">Major</SelectItem>
            <SelectItem value="minor">Minor</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
          </SelectContent>
        </Select>
        <Select value={buildingType} onValueChange={(v) => setBuildingType(v as "all" | "residential" | "commercial")}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="residential">Residential</SelectItem>
            <SelectItem value="commercial">Commercial</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-32 rounded bg-muted animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <FppEmptyState icon={BookOpen} headline="No results" body="Try adjusting your search or filters." />
      ) : (
        <div className="space-y-3">
          {filtered.map((d) => (
            <div
              key={d.id}
              className="bg-card border rounded-r-md border-l-4 p-5"
              style={{ borderLeftColor: pinColor[d.severity || "admin"] }}
            >
              <div className="flex items-start justify-between">
                <span className="font-mono text-sm font-semibold text-foreground">FBC {d.fbc_section}</span>
                <div className="flex items-center gap-2">
                  <SeverityBadge level={(d.severity as "critical" | "major" | "minor" | "admin") || "admin"} />
                  <span className="text-[10px] font-mono uppercase bg-muted px-2 py-0.5 rounded border text-fpp-gray-600">{d.discipline}</span>
                </div>
              </div>
              <h3 className="text-[15px] font-semibold text-foreground mt-1.5">{d.title}</h3>
              <p className="text-sm text-fpp-gray-600 mt-1">{d.description}</p>

              <Collapsible>
                <CollapsibleTrigger className="flex items-center gap-1 mt-3 text-xs text-primary hover:underline">
                  <ChevronDown className="h-3 w-3" /> Standard Comment Language
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-2 bg-muted border rounded p-3 text-xs font-mono text-fpp-gray-600 leading-relaxed">
                    {d.standard_comment_language}
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <div className="flex items-center gap-2 mt-3">
                <Button
                  variant="outline" size="sm" className="text-xs h-7"
                  onClick={() => d.standard_comment_language && handleCopy(d.standard_comment_language, d.id)}
                >
                  <Copy className="h-3 w-3 mr-1" />
                  {copiedId === d.id ? "Copied ✓" : "Copy Comment Text"}
                </Button>

                <Popover open={addingToReview === d.id} onOpenChange={(open) => setAddingToReview(open ? d.id : null)}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="text-xs h-7">
                      <PlusCircle className="h-3 w-3 mr-1" /> Add to Active Review
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-3" align="start">
                    <p className="text-xs font-semibold mb-2">Select project:</p>
                    <div className="space-y-1 max-h-48 overflow-auto">
                      {(projects || []).map((p) => (
                        <Button
                          key={p.id}
                          variant="ghost"
                          size="sm"
                          className="w-full justify-start text-xs h-7"
                          onClick={() => handleAddToReview(d, p.id)}
                        >
                          {p.name}
                        </Button>
                      ))}
                      {(!projects || projects.length === 0) && (
                        <p className="text-xs text-fpp-gray-400">No projects found</p>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>

                <Button variant="ghost" size="sm" className="text-xs h-7">
                  <ExternalLink className="h-3 w-3 mr-1" /> View in FBC
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
