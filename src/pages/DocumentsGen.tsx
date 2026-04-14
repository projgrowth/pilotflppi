import { useState, useMemo } from "react";
import { useProjects } from "@/hooks/useProjects";
import { useReviewFlags } from "@/hooks/useReviewData";
import { useFirmSettings } from "@/hooks/useFirmSettings";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileCheck, MessageSquare, Building2, ClipboardList, Search, CheckCircle2, AlertTriangle, Copy, Download } from "lucide-react";
import { toast } from "sonner";

const documents = [
  { icon: FileCheck, title: "Plan Compliance Affidavit", desc: "Certifies plans comply with the Florida Building Code. Required for each submittal and revision. Auto-populated from project data.", color: "text-primary" },
  { icon: MessageSquare, title: "Review Comment Letter", desc: "Professional comment letter organized by discipline with FBC citations. Generated from all active (unresolved) flags.", color: "text-fpp-gold" },
  { icon: Building2, title: "Notice to Building Official", desc: "Required filing before private provider services begin. Auto-populated with firm credentials and project information.", color: "text-status-admin" },
  { icon: ClipboardList, title: "Log of Approved Documents", desc: "Running log of all approved plan sheets with revision history. Updates automatically as sheets are approved.", color: "text-status-pass" },
  { icon: Search, title: "Inspection Record", desc: "Per-phase inspection log for foundation, framing, rough-in, insulation, and final inspections with inspector credentials.", color: "text-fpp-gray-600" },
];

interface PreflightItem {
  label: string;
  ready: boolean;
  value?: string;
}

function generateCommentLetterHtml(
  project: { name: string; address: string; county: string; jurisdiction: string; trade_type: string },
  flags: { fbc_section: string | null; description: string | null; severity: string | null; sheet_ref: string | null }[],
  firm: { firm_name: string; license_number: string; email: string; phone: string } | null
): string {
  const byDiscipline: Record<string, typeof flags> = {};
  flags.forEach((f) => {
    const key = f.severity === "critical" ? "Critical" : f.severity === "major" ? "Major" : "Minor / Advisory";
    if (!byDiscipline[key]) byDiscipline[key] = [];
    byDiscipline[key].push(f);
  });

  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  let items = "";
  let idx = 1;
  for (const [group, groupFlags] of Object.entries(byDiscipline)) {
    items += `<h3 style="margin-top:16px;font-size:14px;font-weight:600;border-bottom:1px solid #ddd;padding-bottom:4px">${group} (${groupFlags.length})</h3>`;
    for (const f of groupFlags) {
      items += `<p style="margin:6px 0;font-size:13px">${idx}. <strong>FBC ${f.fbc_section || "N/A"}</strong>${f.sheet_ref ? ` — Sheet ${f.sheet_ref}` : ""}: ${f.description || "No description"}${f.severity === "critical" ? " ⚠️" : ""}</p>`;
      idx++;
    }
  }

  return `<div style="font-family:Georgia,serif;max-width:700px;margin:0 auto;padding:32px">
<div style="text-align:center;margin-bottom:24px">
  <h1 style="font-size:18px;margin:0">${firm?.firm_name || "Florida Private Providers, Inc."}</h1>
  <p style="font-size:12px;color:#666;margin:4px 0">License # ${firm?.license_number || "PVP-XXXXX"}</p>
  <p style="font-size:14px;font-weight:600;margin:8px 0">Plan Review Comment Letter</p>
</div>
<p style="font-size:13px"><strong>Date:</strong> ${today}</p>
<p style="font-size:13px"><strong>Project:</strong> ${project.name}</p>
<p style="font-size:13px"><strong>Address:</strong> ${project.address}</p>
<p style="font-size:13px"><strong>County / Jurisdiction:</strong> ${project.county} — ${project.jurisdiction}</p>
<p style="font-size:13px"><strong>Trade(s):</strong> ${project.trade_type}</p>
<hr style="margin:16px 0;border:none;border-top:1px solid #ccc">
<p style="font-size:13px">Pursuant to F.S. 553.791, the following deficiencies were identified during plan review. Corrections must be addressed and plans resubmitted within <strong>14 calendar days</strong>.</p>
${items}
<hr style="margin:16px 0;border:none;border-top:1px solid #ccc">
<p style="font-size:12px;color:#666">Please resubmit corrected plans within 14 calendar days per F.S. 553.791(4)(b). Contact ${firm?.email || "info@flppi.com"} or ${firm?.phone || "(555) 555-0000"} with questions.</p>
</div>`;
}

export default function DocumentsPage() {
  const { data: projects } = useProjects();
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [generating, setGenerating] = useState<string | null>(null);
  const [generatedHtml, setGeneratedHtml] = useState<string>("");
  const { firmSettings } = useFirmSettings();

  const selectedProjectData = useMemo(
    () => (projects || []).find((p) => p.id === selectedProject),
    [projects, selectedProject]
  );

  const { data: flags } = useReviewFlags(selectedProject || undefined);
  const activeFlags = useMemo(() => (flags || []).filter((f) => f.status !== "resolved"), [flags]);

  const getPreflightChecks = (docTitle: string): PreflightItem[] => {
    const p = selectedProjectData;
    const base: PreflightItem[] = [
      { label: "Project Name", ready: !!p?.name, value: p?.name },
      { label: "Address", ready: !!p?.address, value: p?.address },
      { label: "County / Jurisdiction", ready: !!p?.county, value: `${p?.county} — ${p?.jurisdiction}` },
    ];

    if (docTitle === "Review Comment Letter") {
      base.push({ label: "Active Review Flags", ready: activeFlags.length > 0, value: `${activeFlags.length} flag(s)` });
    }
    if (docTitle === "Notice to Building Official" || docTitle === "Plan Compliance Affidavit") {
      base.push({ label: "Firm Name", ready: !!firmSettings?.firm_name, value: firmSettings?.firm_name });
      base.push({ label: "License Number", ready: !!firmSettings?.license_number, value: firmSettings?.license_number });
    }
    return base;
  };

  const handleGenerate = (docTitle: string) => {
    if (docTitle === "Review Comment Letter" && selectedProjectData && activeFlags.length > 0) {
      const html = generateCommentLetterHtml(selectedProjectData, activeFlags, firmSettings ?? null);
      setGeneratedHtml(html);
    } else {
      setGeneratedHtml("");
    }
    setGenerating(docTitle);
  };

  const handleCopyHtml = async () => {
    if (!generatedHtml) return;
    await navigator.clipboard.writeText(generatedHtml);
    toast.success("HTML copied to clipboard");
  };

  const handleDownload = () => {
    if (!generatedHtml) return;
    const blob = new Blob([generatedHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${generating?.replace(/\s+/g, "_")}_${selectedProjectData?.name?.replace(/\s+/g, "_") || "project"}.html`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Document downloaded");
  };

  const preflightItems = generating ? getPreflightChecks(generating) : [];
  const allReady = preflightItems.every((item) => item.ready);

  return (
    <div className="page-enter space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-foreground">Document Generator</h1>
        <p className="text-sm text-fpp-gray-600 mt-1">Generate required Florida Private Provider documents from your active review data.</p>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm text-fpp-gray-600">Generating documents for:</span>
        <Select value={selectedProject} onValueChange={setSelectedProject}>
          <SelectTrigger className="w-80">
            <SelectValue placeholder="Select a project..." />
          </SelectTrigger>
          <SelectContent>
            {(projects || []).map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name} · {p.county}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {documents.map((doc) => (
          <Card key={doc.title} className="shadow-subtle">
            <CardContent className="p-6">
              <doc.icon className={`h-8 w-8 ${doc.color} mb-3`} />
              <h3 className="text-base font-semibold text-foreground">{doc.title}</h3>
              <p className="text-sm text-fpp-gray-600 mt-1.5 leading-relaxed">{doc.desc}</p>
              <Button
                className="mt-4"
                disabled={!selectedProject}
                onClick={() => handleGenerate(doc.title)}
              >
                Generate {doc.title.split(" ").slice(0, 2).join(" ")} →
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!generating} onOpenChange={() => setGenerating(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{generating}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Pre-flight checklist */}
            <div className="space-y-1.5 text-sm">
              {preflightItems.map((item) => (
                <div key={item.label} className="flex items-center gap-2">
                  {item.ready ? (
                    <CheckCircle2 className="h-4 w-4 text-status-pass flex-shrink-0" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-status-minor flex-shrink-0" />
                  )}
                  <span className={item.ready ? "text-foreground" : "text-status-minor"}>
                    {item.label}{item.ready && item.value ? ` — ${item.value}` : item.ready ? "" : " — not yet provided"}
                  </span>
                </div>
              ))}
            </div>

            {/* Generated preview */}
            {generatedHtml ? (
              <div
                className="aspect-[8.5/11] bg-white border rounded p-4 max-h-[400px] overflow-auto text-foreground"
                dangerouslySetInnerHTML={{ __html: generatedHtml }}
              />
            ) : (
              <div className="aspect-[8.5/11] bg-white border rounded p-8 max-h-[400px] overflow-auto">
                <div className="text-center mb-6">
                  <h2 className="text-xl font-semibold">State of Florida</h2>
                  <p className="text-sm text-fpp-gray-600">{generating}</p>
                </div>
                <p className="text-sm text-fpp-gray-600 leading-relaxed">
                  {allReady
                    ? "Document preview will be generated with project-specific data."
                    : "Complete all required fields above to generate this document."}
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setGenerating(null)}>Cancel</Button>
              {generatedHtml && (
                <>
                  <Button variant="outline" onClick={handleCopyHtml}>
                    <Copy className="h-4 w-4 mr-1" /> Copy HTML
                  </Button>
                  <Button onClick={handleDownload}>
                    <Download className="h-4 w-4 mr-1" /> Download
                  </Button>
                </>
              )}
              {!generatedHtml && (
                <Button disabled>Download PDF</Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
