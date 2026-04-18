import { useState, useMemo } from "react";
import DOMPurify from "dompurify";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProjects } from "@/hooks/useProjects";
import { useReviewFlags } from "@/hooks/useReviewData";
import { useFirmSettings } from "@/hooks/useFirmSettings";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileCheck, MessageSquare, Building2, ClipboardList, Search, CheckCircle2, AlertTriangle, Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";

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

type ProjectInfo = { name: string; address: string; county: string; jurisdiction: string; trade_type: string };
type FirmInfoLite = { firm_name: string; license_number: string; email: string; phone: string; address?: string } | null;

const docShellCSS = `
  body { font-family: Georgia, 'Times New Roman', serif; max-width: 720px; margin: 0 auto; padding: 32px; color: #1a1a1a; line-height: 1.6; }
  h1 { font-size: 18px; margin: 0; color: #1a365d; }
  h2 { font-size: 14px; margin: 16px 0 8px; color: #1a365d; border-bottom: 1px solid #cbd5e0; padding-bottom: 4px; }
  p { font-size: 13px; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
  th, td { border: 1px solid #cbd5e0; padding: 5px 8px; text-align: left; }
  th { background: #edf2f7; }
  .meta { font-size: 12px; color: #4a5568; margin: 4px 0; }
  .header { text-align: center; border-bottom: 2px solid #1a365d; padding-bottom: 12px; margin-bottom: 20px; }
  .signature { margin-top: 40px; border-top: 1px solid #1a1a1a; width: 280px; padding-top: 4px; font-size: 11px; }
  .empty { color: #718096; font-style: italic; font-size: 12px; }
`;

function todayLong() {
  return new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function generateCommentLetterHtml(
  project: ProjectInfo,
  flags: { fbc_section: string | null; description: string | null; severity: string | null; sheet_ref: string | null }[],
  firm: FirmInfoLite,
): string {
  const byGroup: Record<string, typeof flags> = {};
  flags.forEach((f) => {
    const key = f.severity === "critical" ? "Critical" : f.severity === "major" ? "Major" : "Minor / Advisory";
    (byGroup[key] ||= []).push(f);
  });

  let items = "";
  let idx = 1;
  for (const [group, groupFlags] of Object.entries(byGroup)) {
    items += `<h2>${group} (${groupFlags.length})</h2>`;
    for (const f of groupFlags) {
      items += `<p>${idx}. <strong>FBC ${f.fbc_section || "N/A"}</strong>${f.sheet_ref ? ` — Sheet ${f.sheet_ref}` : ""}: ${f.description || "No description"}${f.severity === "critical" ? " ⚠️" : ""}</p>`;
      idx++;
    }
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${docShellCSS}</style></head><body>
<div class="header">
  <h1>${firm?.firm_name || "Florida Private Providers, Inc."}</h1>
  <p class="meta">License # ${firm?.license_number || "AR92053"}</p>
  <p style="font-size:14px;font-weight:600;margin:8px 0">Plan Review Comment Letter</p>
</div>
<p><strong>Date:</strong> ${todayLong()}</p>
<p><strong>Project:</strong> ${project.name}</p>
<p><strong>Address:</strong> ${project.address}</p>
<p><strong>County / Jurisdiction:</strong> ${project.county} — ${project.jurisdiction}</p>
<p><strong>Trade(s):</strong> ${project.trade_type}</p>
<hr style="margin:16px 0;border:none;border-top:1px solid #ccc">
<p>Pursuant to F.S. 553.791, the following deficiencies were identified during plan review. Corrections must be addressed and plans resubmitted within <strong>14 calendar days</strong>.</p>
${items}
<hr style="margin:16px 0;border:none;border-top:1px solid #ccc">
<p class="meta">Contact ${firm?.email || "info@flppi.com"} or ${firm?.phone || "(555) 555-0000"} with questions.</p>
</body></html>`;
}

function generatePlanComplianceAffidavitHtml(project: ProjectInfo, firm: FirmInfoLite): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${docShellCSS}</style></head><body>
<div class="header">
  <h1>Plan Compliance Affidavit</h1>
  <p class="meta">Pursuant to Florida Statute 553.791 — Florida Building Code, 8th Edition (2023)</p>
</div>

<p><strong>Date:</strong> ${todayLong()}</p>
<p><strong>Project:</strong> ${project.name}</p>
<p><strong>Address:</strong> ${project.address}</p>
<p><strong>County / Jurisdiction:</strong> ${project.county} — ${project.jurisdiction}</p>
<p><strong>Trade(s):</strong> ${project.trade_type}</p>

<h2>Affidavit Statement</h2>
<p>I, the undersigned licensed Private Provider, hereby certify under penalty of perjury that the construction documents submitted for the above-referenced project have been reviewed for compliance with the Florida Building Code, 8th Edition (2023), all referenced standards, and applicable local amendments adopted by ${project.county} County.</p>

<p>This review has been conducted in accordance with Florida Statute 553.791 and meets the requirements for plan review by a duly licensed Private Provider firm. All deficiencies, if any, have been documented and communicated to the applicant via the accompanying Plan Review Comment Letter.</p>

<p>The undersigned attests that the firm carries the insurance and certifications required by F.S. 553.791(2) and is authorized to perform plan review services in the State of Florida.</p>

<h2>Firm Information</h2>
<p><strong>Firm:</strong> ${firm?.firm_name || "Florida Private Providers, Inc."}</p>
<p><strong>License #:</strong> ${firm?.license_number || "AR92053"}</p>
${firm?.address ? `<p><strong>Address:</strong> ${firm.address}</p>` : ""}
<p><strong>Contact:</strong> ${firm?.phone || "(555) 555-0000"} • ${firm?.email || "info@flppi.com"}</p>

<div class="signature">
  Signature of Licensed Private Provider<br/>
  ${firm?.firm_name || "Florida Private Providers, Inc."}<br/>
  License # ${firm?.license_number || "AR92053"}
</div>
</body></html>`;
}

function generateNoticeToBuildingOfficialHtml(project: ProjectInfo, firm: FirmInfoLite): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${docShellCSS}</style></head><body>
<div class="header">
  <h1>Notice to Building Official</h1>
  <p class="meta">Required Pre-Service Notice — F.S. 553.791(4)(a)</p>
</div>

<p><strong>Date:</strong> ${todayLong()}</p>
<p><strong>To:</strong> Building Official, ${project.jurisdiction || project.county}</p>

<h2>Notice of Private Provider Services</h2>
<p>Pursuant to Florida Statute 553.791, the undersigned firm hereby provides notice of intent to perform Private Provider plan review and/or inspection services for the project identified below.</p>

<p><strong>Project Name:</strong> ${project.name}</p>
<p><strong>Project Address:</strong> ${project.address}</p>
<p><strong>County:</strong> ${project.county}</p>
<p><strong>Trade(s):</strong> ${project.trade_type}</p>

<h2>Private Provider Firm</h2>
<p><strong>Firm:</strong> ${firm?.firm_name || "Florida Private Providers, Inc."}</p>
<p><strong>License #:</strong> ${firm?.license_number || "AR92053"}</p>
${firm?.address ? `<p><strong>Address:</strong> ${firm.address}</p>` : ""}
<p><strong>Phone:</strong> ${firm?.phone || "(555) 555-0000"}</p>
<p><strong>Email:</strong> ${firm?.email || "info@flppi.com"}</p>

<h2>Scope &amp; Insurance Affirmation</h2>
<p>The firm carries professional liability insurance in compliance with F.S. 553.791(2) and assumes responsibility for the scope of services described herein. All required notifications, inspections, and certifications will be furnished to the building official as required by statute.</p>

<div class="signature">
  Authorized Signature<br/>
  ${firm?.firm_name || "Florida Private Providers, Inc."}
</div>
</body></html>`;
}

interface PlanReviewRecord { id: string; round: number; qc_status: string; updated_at: string; ai_findings: unknown }
function generateApprovedDocumentsLogHtml(project: ProjectInfo, reviews: PlanReviewRecord[]): string {
  const approved = reviews.filter((r) => r.qc_status === "qc_approved");
  const rows = approved.length === 0
    ? `<tr><td colspan="4" class="empty">No approved documents yet.</td></tr>`
    : approved.map((r) => {
        const findingCount = Array.isArray(r.ai_findings) ? (r.ai_findings as unknown[]).length : 0;
        return `<tr><td>Round ${r.round}</td><td>${new Date(r.updated_at).toLocaleDateString()}</td><td>${findingCount}</td><td>QC Approved</td></tr>`;
      }).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${docShellCSS}</style></head><body>
<div class="header">
  <h1>Log of Approved Documents</h1>
  <p class="meta">${project.name} — ${project.address}</p>
</div>

<p><strong>County / Jurisdiction:</strong> ${project.county} — ${project.jurisdiction}</p>
<p><strong>Trade(s):</strong> ${project.trade_type}</p>
<p><strong>Generated:</strong> ${todayLong()}</p>

<h2>Approved Plan Review Rounds</h2>
<table>
  <thead><tr><th>Round</th><th>Approval Date</th><th>Findings Count</th><th>Status</th></tr></thead>
  <tbody>${rows}</tbody>
</table>

<p class="meta" style="margin-top:16px">This log reflects plan review rounds that have received QC approval. Refer to individual comment letters for detailed findings and resolutions.</p>
</body></html>`;
}

interface InspectionRecord { id: string; inspection_type: string; scheduled_at: string | null; result: string; certificate_issued: boolean; notes: string | null }
function generateInspectionRecordHtml(project: ProjectInfo, inspections: InspectionRecord[]): string {
  const rows = inspections.length === 0
    ? `<tr><td colspan="5" class="empty">No inspections recorded.</td></tr>`
    : inspections.map((i) => `
        <tr>
          <td style="text-transform:capitalize">${i.inspection_type.replace(/_/g, " ")}</td>
          <td>${i.scheduled_at ? new Date(i.scheduled_at).toLocaleDateString() : "—"}</td>
          <td style="text-transform:capitalize">${i.result}</td>
          <td>${i.certificate_issued ? "Yes" : "No"}</td>
          <td>${(i.notes || "").slice(0, 60) || "—"}</td>
        </tr>`).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${docShellCSS}</style></head><body>
<div class="header">
  <h1>Inspection Record</h1>
  <p class="meta">${project.name} — ${project.address}</p>
</div>

<p><strong>County / Jurisdiction:</strong> ${project.county} — ${project.jurisdiction}</p>
<p><strong>Trade(s):</strong> ${project.trade_type}</p>
<p><strong>Generated:</strong> ${todayLong()}</p>

<h2>Inspections Performed</h2>
<table>
  <thead><tr><th>Phase</th><th>Date</th><th>Result</th><th>Cert. Issued</th><th>Notes</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</body></html>`;
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

  const { data: planReviews } = useQuery({
    queryKey: ["documents-plan-reviews", selectedProject],
    enabled: !!selectedProject,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plan_reviews")
        .select("id, round, qc_status, updated_at, ai_findings")
        .eq("project_id", selectedProject)
        .order("round");
      if (error) throw error;
      return (data || []) as PlanReviewRecord[];
    },
  });

  const { data: inspections } = useQuery({
    queryKey: ["documents-inspections", selectedProject],
    enabled: !!selectedProject,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inspections")
        .select("id, inspection_type, scheduled_at, result, certificate_issued, notes")
        .eq("project_id", selectedProject)
        .order("scheduled_at");
      if (error) throw error;
      return (data || []) as InspectionRecord[];
    },
  });

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
    if (docTitle === "Log of Approved Documents") {
      base.push({ label: "Plan Reviews", ready: (planReviews || []).length > 0, value: `${(planReviews || []).length} round(s)` });
    }
    if (docTitle === "Inspection Record") {
      base.push({ label: "Inspections", ready: (inspections || []).length > 0, value: `${(inspections || []).length} inspection(s)` });
    }
    return base;
  };

  const handleGenerate = (docTitle: string) => {
    if (!selectedProjectData) {
      toast.error("Select a project first.");
      return;
    }
    let html = "";
    switch (docTitle) {
      case "Review Comment Letter":
        if (activeFlags.length === 0) {
          toast.message("No active flags — letter will be empty. Open a plan review to generate findings first.");
        }
        html = generateCommentLetterHtml(selectedProjectData, activeFlags, firmSettings ?? null);
        break;
      case "Plan Compliance Affidavit":
        html = generatePlanComplianceAffidavitHtml(selectedProjectData, firmSettings ?? null);
        break;
      case "Notice to Building Official":
        html = generateNoticeToBuildingOfficialHtml(selectedProjectData, firmSettings ?? null);
        break;
      case "Log of Approved Documents":
        html = generateApprovedDocumentsLogHtml(selectedProjectData, planReviews || []);
        break;
      case "Inspection Record":
        html = generateInspectionRecordHtml(selectedProjectData, inspections || []);
        break;
    }
    setGeneratedHtml(html);
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
    <div className="p-8 md:p-10 max-w-7xl mx-auto">
      <PageHeader
        title="Document Generator"
        subtitle="Generate required Florida Private Provider documents from your active review data."
      />

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
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(generatedHtml) }}
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
              <Button variant="outline" onClick={() => setGenerating(null)}>Close</Button>
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
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
