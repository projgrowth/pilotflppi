import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FileDown, Package, FileText, ClipboardList, Shield, Zap, ChevronDown } from "lucide-react";
import type { Finding } from "@/components/FindingCard";
import { getCountyRequirements, getSupplementalSectionLabel, type SupplementalSection } from "@/lib/county-requirements";
import { CommentLetterExport, type FirmInfo } from "@/components/CommentLetterExport";
import { supabase } from "@/integrations/supabase/client";
import { printViaIframe } from "@/lib/print-utils";

interface CountyDocumentPackageProps {
  projectId?: string;
  projectName: string;
  address: string;
  county: string;
  jurisdiction: string;
  tradeType: string;
  round: number;
  findings: Finding[];
  findingStatuses: Record<number, string>;
  firmInfo?: FirmInfo | null;
  onDocumentGenerated?: () => void;
}

function buildProductChecklistHTML(props: CountyDocumentPackageProps): string {
  const config = getCountyRequirements(props.county);
  const isNOA = config.productApprovalFormat === "NOA";
  const title = isNOA ? "NOA Product Approval Checklist" : "FL# Product Approval Checklist";

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  @page { margin: 0.75in 1in; size: letter; }
  body { font-family: 'Georgia', serif; font-size: 10pt; line-height: 1.5; color: #1a1a1a; }
  h1 { font-size: 14pt; color: #1a365d; border-bottom: 2px solid #1a365d; padding-bottom: 6px; margin-bottom: 16px; }
  .meta { font-size: 9pt; color: #4a5568; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th { background: #edf2f7; text-align: left; padding: 6px 8px; font-size: 9pt; border: 1px solid #cbd5e0; }
  td { padding: 6px 8px; font-size: 9pt; border: 1px solid #cbd5e0; }
  .note { font-size: 8pt; color: #718096; margin-top: 12px; font-style: italic; }
</style></head><body>
<h1>${title}</h1>
<div class="meta">
  <p><strong>Project:</strong> ${props.projectName} | <strong>County:</strong> ${config.label} County</p>
  <p><strong>Approval Format:</strong> ${isNOA ? "Miami-Dade Notice of Acceptance (NOA)" : "Florida Product Approval (FL#)"}</p>
</div>
<table>
  <tr><th>#</th><th>Product / Assembly</th><th>${isNOA ? "NOA Number" : "FL# Number"}</th><th>Expiration</th><th>Status</th></tr>
  <tr><td>1</td><td>Impact-Resistant Windows</td><td></td><td></td><td>☐ Verified</td></tr>
  <tr><td>2</td><td>Impact-Resistant Doors</td><td></td><td></td><td>☐ Verified</td></tr>
  <tr><td>3</td><td>Roofing System</td><td></td><td></td><td>☐ Verified</td></tr>
  <tr><td>4</td><td>Roof-to-Wall Connectors</td><td></td><td></td><td>☐ Verified</td></tr>
  <tr><td>5</td><td>Exterior Cladding</td><td></td><td></td><td>☐ Verified</td></tr>
  <tr><td>6</td><td>Garage Door</td><td></td><td></td><td>☐ Verified</td></tr>
  <tr><td>7</td><td>Shutters / Protection</td><td></td><td></td><td>☐ Verified</td></tr>
  <tr><td>8</td><td>Skylights</td><td></td><td></td><td>☐ Verified</td></tr>
</table>
${config.submissionNotes.length > 0 ? `<div class="note"><strong>County Notes:</strong><br/>${config.submissionNotes.join("<br/>")}</div>` : ""}
</body></html>`;
}

function buildInspectionReadinessHTML(props: CountyDocumentPackageProps): string {
  const config = getCountyRequirements(props.county);

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  @page { margin: 0.75in 1in; size: letter; }
  body { font-family: 'Georgia', serif; font-size: 10pt; line-height: 1.5; color: #1a1a1a; }
  h1 { font-size: 14pt; color: #1a365d; border-bottom: 2px solid #1a365d; padding-bottom: 6px; margin-bottom: 16px; }
  .meta { font-size: 9pt; color: #4a5568; margin-bottom: 16px; }
  .section { margin-bottom: 16px; }
  .section h2 { font-size: 11pt; color: #2d3748; margin-bottom: 8px; }
  .checklist { list-style: none; padding: 0; }
  .checklist li { padding: 4px 0; font-size: 9.5pt; }
  .checklist li::before { content: "☐ "; }
  .note { font-size: 8pt; color: #718096; margin-top: 12px; font-style: italic; }
</style></head><body>
<h1>Inspection Readiness Packet</h1>
<div class="meta">
  <p><strong>Project:</strong> ${props.projectName}</p>
  <p><strong>Address:</strong> ${props.address}</p>
  <p><strong>County:</strong> ${config.label} County | <strong>Design Wind Speed:</strong> ${config.designWindSpeed}</p>
</div>
<div class="section">
  <h2>Pre-Inspection Checklist</h2>
  <ul class="checklist">
    <li>Approved plans on-site with all revisions</li>
    <li>Private Provider notice posted at site</li>
    <li>Permit card visible and current</li>
    <li>All required product approvals (${config.productApprovalFormat}) on file</li>
    <li>Engineer/architect inspection reports current</li>
    ${config.hvhz ? "<li>HVHZ product documentation available (NOA certificates)</li>" : ""}
    ${config.cccl ? "<li>CCCL survey and compliance documentation</li>" : ""}
    <li>Threshold building special inspector reports (if applicable)</li>
    <li>Energy code compliance documentation</li>
    <li>Fire-resistive assemblies listing sheets on site</li>
  </ul>
</div>
<div class="section">
  <h2>Required On-Site Documents</h2>
  <ul class="checklist">
    <li>Form 553.791 — Private Provider Notice</li>
    <li>Building permit</li>
    <li>Approved construction documents (sealed)</li>
    <li>Product approval documentation</li>
    <li>Special inspection reports</li>
    ${config.amendments.map((a) => `<li>${a.ref}: ${a.description}</li>`).join("")}
  </ul>
</div>
</body></html>`;
}

async function persistAndNotify(html: string, filename: string, projectId?: string, onDone?: () => void) {
  if (projectId) {
    const blob = new Blob([html], { type: "text/html" });
    await supabase.storage.from("documents").upload(`projects/${projectId}/${filename}`, blob, { upsert: true }).catch(() => {});
    onDone?.();
  }
}

export function CountyDocumentPackage(props: CountyDocumentPackageProps) {
  const config = getCountyRequirements(props.county);
  const [downloading, setDownloading] = useState(false);
  const safeName = props.projectName.replace(/\s+/g, "_");

  const handleDownloadProductChecklist = () => {
    const html = buildProductChecklistHTML(props);
    const filename = `Product-Checklist-${safeName}.html`;
    printViaIframe(html, filename);
    persistAndNotify(html, filename, props.projectId, props.onDocumentGenerated);
  };

  const handleDownloadInspectionPacket = () => {
    const html = buildInspectionReadinessHTML(props);
    const filename = `Inspection-Readiness-${safeName}.html`;
    printViaIframe(html, filename);
    persistAndNotify(html, filename, props.projectId, props.onDocumentGenerated);
  };

  const handleFullPackage = async () => {
    setDownloading(true);
    try {
      handleDownloadProductChecklist();
      await new Promise((r) => setTimeout(r, 500));
      handleDownloadInspectionPacket();
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <CommentLetterExport {...props} onDocumentGenerated={props.onDocumentGenerated} />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="gap-1.5 text-xs">
            <Package className="h-3.5 w-3.5" />
            Docs
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={handleDownloadProductChecklist} className="text-xs gap-2">
            <ClipboardList className="h-3.5 w-3.5" />
            {config.productApprovalFormat === "NOA" ? "NOA Checklist" : "Product Approval Checklist"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleDownloadInspectionPacket} className="text-xs gap-2">
            <Shield className="h-3.5 w-3.5" />
            Inspection Readiness Packet
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleFullPackage} disabled={downloading} className="text-xs gap-2 font-medium">
            <Package className="h-3.5 w-3.5" />
            Full {config.label} County Package
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
