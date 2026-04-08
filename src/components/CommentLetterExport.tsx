import { Button } from "@/components/ui/button";
import { FileDown, Printer } from "lucide-react";
import type { Finding } from "@/components/FindingCard";
import { getDisciplineLabel, getCountyLabel, isHVHZ, DISCIPLINE_ORDER } from "@/lib/county-utils";

interface CommentLetterExportProps {
  projectName: string;
  address: string;
  county: string;
  jurisdiction: string;
  tradeType: string;
  round: number;
  findings: Finding[];
  findingStatuses: Record<number, string>;
}

function groupByDiscipline(findings: Finding[]) {
  const groups: Record<string, { finding: Finding; index: number }[]> = {};
  findings.forEach((f, i) => {
    const d = f.discipline || "structural";
    if (!groups[d]) groups[d] = [];
    groups[d].push({ finding: f, index: i });
  });
  return groups;
}

function buildLetterHTML(props: CommentLetterExportProps): string {
  const { projectName, address, county, jurisdiction, tradeType, round, findings, findingStatuses } = props;
  const hvhz = isHVHZ(county);
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const grouped = groupByDiscipline(findings);

  const openFindings = findings.filter((_, i) => (findingStatuses[i] || "open") === "open");
  const resolvedFindings = findings.filter((_, i) => findingStatuses[i] === "resolved");
  const deferredFindings = findings.filter((_, i) => findingStatuses[i] === "deferred");

  let itemNumber = 0;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  @page { margin: 0.75in 1in; size: letter; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Georgia', 'Times New Roman', serif; font-size: 10.5pt; line-height: 1.6; color: #1a1a1a; }
  .letterhead { text-align: center; border-bottom: 3px double #1a365d; padding-bottom: 12px; margin-bottom: 24px; }
  .letterhead h1 { font-size: 16pt; color: #1a365d; letter-spacing: 2px; margin-bottom: 2px; }
  .letterhead p { font-size: 8pt; color: #4a5568; letter-spacing: 1px; }
  .license { font-size: 8.5pt; color: #2d3748; font-weight: bold; margin-top: 4px; }
  .header-info { margin-bottom: 20px; }
  .header-info table { width: 100%; font-size: 9.5pt; }
  .header-info td { padding: 2px 0; vertical-align: top; }
  .header-info td:first-child { font-weight: bold; color: #2d3748; width: 140px; }
  .hvhz-banner { background: #fff5f5; border: 1px solid #e53e3e; border-radius: 4px; padding: 8px 12px; margin-bottom: 16px; font-size: 9pt; color: #c53030; }
  .body-text { margin-bottom: 16px; text-align: justify; }
  .discipline-header { font-size: 11pt; font-weight: bold; color: #1a365d; border-bottom: 1px solid #cbd5e0; padding-bottom: 4px; margin: 20px 0 10px; page-break-after: avoid; }
  .finding-item { margin-bottom: 12px; padding-left: 20px; page-break-inside: avoid; }
  .finding-number { font-weight: bold; color: #1a365d; }
  .finding-severity { display: inline-block; font-size: 8pt; font-weight: bold; padding: 1px 6px; border-radius: 3px; margin-left: 6px; }
  .sev-critical { background: #fed7d7; color: #c53030; }
  .sev-major { background: #fefcbf; color: #975a16; }
  .sev-minor { background: #e2e8f0; color: #4a5568; }
  .code-ref { font-family: 'Courier New', monospace; font-size: 9pt; background: #f7fafc; padding: 1px 4px; border-radius: 2px; }
  .county-flag { font-size: 8pt; color: #e53e3e; font-weight: bold; }
  .status-tag { font-size: 8pt; font-weight: bold; padding: 1px 4px; border-radius: 2px; margin-left: 4px; }
  .status-resolved { background: #c6f6d5; color: #276749; }
  .status-deferred { background: #fefcbf; color: #975a16; }
  .recommendation { margin-top: 4px; font-style: italic; color: #4a5568; font-size: 9.5pt; }
  .summary-box { background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 12px; margin: 20px 0; font-size: 9.5pt; }
  .summary-box h3 { font-size: 10pt; margin-bottom: 6px; color: #1a365d; }
  .closing { margin-top: 30px; }
  .signature-block { margin-top: 40px; }
  .signature-line { border-top: 1px solid #1a1a1a; width: 250px; margin-top: 40px; padding-top: 4px; font-size: 9pt; }
  .footer { margin-top: 30px; padding-top: 8px; border-top: 1px solid #cbd5e0; font-size: 7.5pt; color: #718096; text-align: center; }
</style>
</head><body>

<div class="letterhead">
  <h1>FLORIDA PRIVATE PROVIDERS</h1>
  <p>LICENSED PRIVATE PROVIDER FIRM</p>
  <p class="license">License # PVP-XXXXX | F.S. 553.791</p>
  <p>Plan Review &bull; Inspections &bull; Code Compliance</p>
</div>

<div class="header-info">
  <table>
    <tr><td>Date:</td><td>${date}</td></tr>
    <tr><td>Project:</td><td><strong>${projectName}</strong></td></tr>
    <tr><td>Address:</td><td>${address}</td></tr>
    <tr><td>County:</td><td>${getCountyLabel(county)} County${hvhz ? ' (HVHZ)' : ''}</td></tr>
    <tr><td>Jurisdiction:</td><td>${jurisdiction || 'N/A'}</td></tr>
    <tr><td>Trade(s):</td><td style="text-transform:capitalize">${tradeType}</td></tr>
    <tr><td>Review Round:</td><td>#${round}</td></tr>
    <tr><td>Permit Application #:</td><td>[TO BE ASSIGNED]</td></tr>
  </table>
</div>

${hvhz ? '<div class="hvhz-banner"><strong>HIGH VELOCITY HURRICANE ZONE (HVHZ)</strong> — Enhanced requirements per FBC 1626, Miami-Dade TAS 201/202/203 apply to this project.</div>' : ''}

<p class="body-text"><strong>RE: Plan Review Comment Letter — Round ${round}</strong></p>

<p class="body-text">Pursuant to Florida Statute 553.791, Florida Private Providers, Inc. has completed a plan review of the above-referenced project. The following deficiencies and comments have been identified during our review of the submitted construction documents against the Florida Building Code, 8th Edition (2023) and all applicable referenced standards.</p>

<p class="body-text">This review was completed within the statutory 21-calendar-day review period. The applicant is required to address all deficiency items and resubmit corrected plans within <strong>14 calendar days</strong>.</p>

<div class="summary-box">
  <h3>Review Summary</h3>
  <p>Total Findings: <strong>${findings.length}</strong> | 
  Open: <strong>${openFindings.length}</strong> | 
  Resolved: <strong>${resolvedFindings.length}</strong> | 
  Deferred: <strong>${deferredFindings.length}</strong></p>
  <p>Critical: ${findings.filter(f => f.severity === 'critical').length} | 
  Major: ${findings.filter(f => f.severity === 'major').length} | 
  Minor: ${findings.filter(f => f.severity === 'minor').length}</p>
</div>

${DISCIPLINE_ORDER.filter(d => grouped[d]).map(discipline => {
  const items = grouped[discipline];
  return `
<div class="discipline-header">${getDisciplineLabel(discipline)}</div>
${items.map(({ finding, index }) => {
  itemNumber++;
  const status = findingStatuses[index] || "open";
  return `
<div class="finding-item">
  <p>
    <span class="finding-number">${itemNumber}.</span>
    <span class="finding-severity sev-${finding.severity}">${finding.severity.toUpperCase()}</span>
    ${status !== 'open' ? `<span class="status-tag status-${status}">${status.toUpperCase()}</span>` : ''}
    ${finding.county_specific ? '<span class="county-flag"> [County Amendment]</span>' : ''}
  </p>
  <p><span class="code-ref">${finding.code_ref}</span> — Sheet: ${finding.page}</p>
  <p>${finding.description}</p>
  <p class="recommendation"><strong>Required Action:</strong> ${finding.recommendation}</p>
</div>`;
}).join('')}`;
}).join('')}

<div class="closing">
  <p class="body-text">All items marked as CRITICAL must be addressed prior to plan approval. Failure to resubmit corrected documents within the 14-day resubmission period may result in the review expiring, requiring a new application and review fees.</p>
  
  <p class="body-text">Should you have any questions regarding this comment letter, please contact our office at your earliest convenience.</p>
  
  <p class="body-text">Respectfully submitted,</p>
</div>

<div class="signature-block">
  <div class="signature-line">
    Plan Review Engineer<br>
    Florida Private Providers, Inc.<br>
    License # PVP-XXXXX
  </div>
</div>

<div class="footer">
  Florida Private Providers, Inc. | Licensed Private Provider under F.S. 553.791 | This document is confidential and intended for the addressee only.
</div>

</body></html>`;
}

function printViaIframe(html: string) {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "-9999px";
  iframe.style.top = "-9999px";
  iframe.style.width = "0";
  iframe.style.height = "0";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();

  iframe.onload = () => {
    setTimeout(() => {
      iframe.contentWindow?.print();
      setTimeout(() => {
        document.body.removeChild(iframe);
      }, 1000);
    }, 300);
  };
}

export function CommentLetterExport(props: CommentLetterExportProps) {
  const handlePrint = () => {
    const html = buildLetterHTML(props);
    printViaIframe(html);
  };

  const handleDownloadHTML = () => {
    const html = buildLetterHTML(props);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Comment-Letter-R${props.round}-${props.projectName.replace(/\s+/g, "_")}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex gap-2">
      <Button size="sm" variant="outline" onClick={handleDownloadHTML} className="gap-1.5">
        <FileDown className="h-3.5 w-3.5" />
        Download
      </Button>
      <Button size="sm" variant="outline" onClick={handlePrint} className="gap-1.5">
        <Printer className="h-3.5 w-3.5" />
        Print
      </Button>
    </div>
  );
}
