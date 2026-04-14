import { useState, useMemo } from "react";
import { useDeficiencies } from "@/hooks/useReviewData";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import SeverityBadge from "@/components/shared/SeverityBadge";
import FppEmptyState from "@/components/shared/FppEmptyState";
import { Search, Copy, PlusCircle, ExternalLink, ChevronDown, BookOpen } from "lucide-react";
import { toast } from "sonner";

export default function Deficiencies() {
  const { data: deficiencies, isLoading } = useDeficiencies();
  const [search, setSearch] = useState("");
  const [discipline, setDiscipline] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return (deficiencies || []).filter((d) => {
      const q = search.toLowerCase();
      const matchSearch = !q || d.fbc_section.toLowerCase().includes(q) || d.title.toLowerCase().includes(q) || (d.description || "").toLowerCase().includes(q) || (d.standard_comment_language || "").toLowerCase().includes(q);
      const matchDisc = discipline === "all" || d.discipline === discipline;
      const matchSev = severity === "all" || d.severity === severity;
      return matchSearch && matchDisc && matchSev;
    });
  }, [deficiencies, search, discipline, severity]);

  const handleCopy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success("Comment text copied");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const pinColor: Record<string, string> = {
    critical: "#D63230", major: "#E8831A", minor: "#D4A017", admin: "#5B8DB8",
  };

  return (
    <div className="page-enter space-y-6">
      <div>
        <h1 className="font-display text-3xl text-foreground">Deficiency Library</h1>
        <p className="text-sm text-fpp-gray-600 mt-1">Pre-written Florida Building Code deficiencies with professional comment language. Click any item to copy comment text or add to an active review.</p>
      </div>

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
        <span className="text-xs font-mono text-fpp-gray-400">{filtered.length} deficiencies shown</span>
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
                  <SeverityBadge level={(d.severity as any) || "admin"} />
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
                <Button variant="outline" size="sm" className="text-xs h-7">
                  <PlusCircle className="h-3 w-3 mr-1" /> Add to Active Review
                </Button>
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
