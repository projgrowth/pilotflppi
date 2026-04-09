import { Button } from "@/components/ui/button";
import { FileDown, Printer } from "lucide-react";
import type { Finding } from "@/components/FindingCard";
import { getDisciplineLabel, getCountyLabel, DISCIPLINE_ORDER } from "@/lib/county-utils";
import { getCountyRequirements, getSupplementalSectionLabel, type CountyRequirements, type SupplementalSection } from "@/lib/county-requirements";

export interface FirmInfo {
  firm_name: string;
  license_number: string;
  email: string;
  phone: string;
  address: string;
  logo_url: string;
  closing_language: string;
}

interface CommentLetterExportProps {
  projectName: string;
  address: string;
  county: string;
  jurisdiction: string;
  tradeType: string;
  round: number;
  findings: Finding[];
  findingStatuses: Record<number, string>;
  firmInfo?: FirmInfo | null;
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

function buildSupplementalSections(config: CountyRequirements): string {
  const sections: string[] = [];

  for (const section of config.supplementalSections) {
    switch (section) {
      case "wind_mitigation":
        sections.push(`
<div class="supplemental-section">
  <h3>Wind Mitigation Summary</h3>
  <p>Design wind speed: <strong>${config.designWindSpeed}</strong></p>
  <p>All structural connections, roof-to-wall attachments, and opening protection shall comply with ASCE 7-22 and FBC 2023 Chapter 16.</p>
  <p>Product approvals: <strong>${config.productApprovalFormat === "NOA" ? "Miami-Dade NOA required" : "Florida Product Approval (FL#) accepted"}</strong></p>
</div>`);
        break;

      case "wind_mitigation_enhanced":
        sections.push(`
<div class="supplemental-section hvhz-section">
  <h3>Enhanced Wind Mitigation — HVHZ Requirements</h3>
  <p>Design wind speed: <strong>${config.designWindSpeed}</strong></p>
  <p>This project is located in the <strong>High Velocity Hurricane Zone (HVHZ)</strong>. All products and assemblies must comply with:</p>
  <ul>
    <li>FBC 2023 Section 1626 — HVHZ structural requirements</li>
    <li>FBC 2023 Section 1523 — Enhanced roofing (HVHZ)</li>
    <li>Miami-Dade TAS 201, 202, 203 — Impact test protocols</li>
    <li>All glazed openings require large and small missile impact testing</li>
  </ul>
  <p>Product approvals: <strong>Miami-Dade Notice of Acceptance (NOA) required. FL# alone is NOT accepted in HVHZ.</strong></p>
</div>`);
        break;

      case "flood_zone":
        sections.push(`
<div class="supplemental-section">
  <h3>Flood Zone Compliance Statement</h3>
  <p>The project location may be within a FEMA-designated flood zone. The following requirements apply per FBC 2023 Chapter 31 and ASCE 24:</p>
  <ul>
    <li>Base Flood Elevation (BFE) determination required</li>
    <li>Lowest floor elevation must be at or above BFE + freeboard per local ordinance</li>
    <li>Flood-resistant materials required below BFE</li>
    <li>Proper flood vent sizing per FEMA TB-1</li>
  </ul>
</div>`);
        break;

      case "threshold_building":
        sections.push(`
<div class="supplemental-section">
  <h3>Threshold Building Disclosure</h3>
  <p>Per Florida Statute 553.71(12), a threshold building is defined as any building that is greater than 3 stories, has an assembly occupancy exceeding 5,000 sq ft, or has a construction cost exceeding <strong>$${(config.thresholdBuildingAmount / 1_000_000).toFixed(0)}M</strong>.</p>
  <p>If this project qualifies as a threshold building:</p>
  <ul>
    <li>A Special Inspector must be engaged per F.S. 553.79</li>
    <li>Threshold building affidavit required prior to permitting</li>
    <li>Structural inspections by a qualified Special Inspector at all critical phases</li>
  </ul>
</div>`);
        break;

      case "noa_table":
        sections.push(`
<div class="supplemental-section">
  <h3>Required Product Approvals — NOA Table</h3>
  <table class="product-table">
    <tr><th>Product / Assembly</th><th>NOA Number</th><th>Expiration</th><th>Verified</th></tr>
    <tr><td>Impact Windows</td><td>[TO BE PROVIDED]</td><td></td><td>☐</td></tr>
    <tr><td>Impact Doors</td><td>[TO BE PROVIDED]</td><td></td><td>☐</td></tr>
    <tr><td>Roofing System</td><td>[TO BE PROVIDED]</td><td></td><td>☐</td></tr>
    <tr><td>Roof-to-Wall Connectors</td><td>[TO BE PROVIDED]</td><td></td><td>☐</td></tr>
    <tr><td>Exterior Cladding</td><td>[TO BE PROVIDED]</td><td></td><td>☐</td></tr>
    <tr><td>Shutters / Protection</td><td>[TO BE PROVIDED]</td><td></td><td>☐</td></tr>
  </table>
</div>`);
        break;

      case "product_approval_table":
        sections.push(`
<div class="supplemental-section">
  <h3>Required Product Approvals — FL# Table</h3>
  <table class="product-table">
    <tr><th>Product / Assembly</th><th>FL# Number</th><th>Expiration</th><th>Verified</th></tr>
    <tr><td>Windows</td><td>[TO BE PROVIDED]</td><td></td><td>☐</td></tr>
    <tr><td>Doors</td><td>[TO BE PROVIDED]</td><td></td><td>☐</td></tr>
    <tr><td>Roofing System</td><td>[TO BE PROVIDED]</td><td></td><td>☐</td></tr>
    <tr><td>Exterior Cladding</td><td>[TO BE PROVIDED]</td><td></td><td>☐</td></tr>
  </table>
</div>`);
        break;

      case "cccl_compliance":
        sections.push(`
<div class="supplemental-section">
  <h3>Coastal Construction Control Line (CCCL)</h3>
  <p>If the project is located seaward of the Coastal Construction Control Line, additional requirements per F.S. 161.053 and FBC 2023 Chapter 31 apply:</p>
  <ul>
    <li>CCCL survey and siting plan required</li>
    <li>Enhanced foundation requirements per ASCE 7-22 Chapter 12</li>
    <li>FDEP permit may be required for construction seaward of CCCL</li>
  </ul>
</div>`);
        break;

      case "energy_compliance":
        sections.push(`
<div class="supplemental-section">
  <h3>Energy Code Compliance</h3>
  <p>Compliance path: <strong>${config.energyCodePath === "prescriptive" ? "Prescriptive (FBC Energy Ch. 4)" : config.energyCodePath === "performance" ? "Performance (FBC Energy Ch. 4)" : "Prescriptive or Performance (FBC Energy Ch. 4)"}</strong></p>
  <p>Energy compliance documentation (Form 405 or equivalent) must be submitted with construction documents.</p>
</div>`);
        break;
    }
  }

  return sections.join("\n");
}

function buildLetterHTML(props: CommentLetterExportProps): string {
  const { projectName, address, county, jurisdiction, tradeType, round, findings, findingStatuses, firmInfo } = props;
  const firm = firmInfo || { firm_name: "FLORIDA PRIVATE PROVIDERS", license_number: "PVP-XXXXX", email: "", phone: "", address: "", logo_url: "", closing_language: "" };
  const config = getCountyRequirements(county);
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
  .addressee { background: #f7fafc; border-left: 3px solid #1a365d; padding: 8px 12px; margin-bottom: 16px; font-size: 9pt; }
  .addressee strong { color: #1a365d; }
  .header-info { margin-bottom: 20px; }
  .header-info table { width: 100%; font-size: 9.5pt; }
  .header-info td { padding: 2px 0; vertical-align: top; }
  .header-info td:first-child { font-weight: bold; color: #2d3748; width: 140px; }
  .hvhz-banner { background: #fff5f5; border: 1px solid #e53e3e; border-radius: 4px; padding: 8px 12px; margin-bottom: 16px; font-size: 9pt; color: #c53030; }
  .county-notes { background: #fffbeb; border: 1px solid #d69e2e; border-radius: 4px; padding: 8px 12px; margin-bottom: 16px; font-size: 8.5pt; color: #975a16; }
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
  .amendment-ref { font-size: 8pt; color: #2b6cb0; font-style: italic; }
  .status-tag { font-size: 8pt; font-weight: bold; padding: 1px 4px; border-radius: 2px; margin-left: 4px; }
  .status-resolved { background: #c6f6d5; color: #276749; }
  .status-deferred { background: #fefcbf; color: #975a16; }
  .recommendation { margin-top: 4px; font-style: italic; color: #4a5568; font-size: 9.5pt; }
  .summary-box { background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 12px; margin: 20px 0; font-size: 9.5pt; }
  .summary-box h3 { font-size: 10pt; margin-bottom: 6px; color: #1a365d; }
  .supplemental-section { margin: 20px 0; padding: 12px; border: 1px solid #e2e8f0; border-radius: 4px; page-break-inside: avoid; }
  .supplemental-section h3 { font-size: 10pt; color: #1a365d; margin-bottom: 8px; border-bottom: 1px solid #edf2f7; padding-bottom: 4px; }
  .supplemental-section ul { margin-left: 16px; font-size: 9.5pt; }
  .supplemental-section li { margin-bottom: 4px; }
  .supplemental-section p { font-size: 9.5pt; margin-bottom: 6px; }
  .hvhz-section { background: #fff5f5; border-color: #feb2b2; }
  .product-table { width: 100%; border-collapse: collapse; font-size: 9pt; margin-top: 8px; }
  .product-table th { background: #edf2f7; padding: 4px 6px; border: 1px solid #cbd5e0; text-align: left; }
  .product-table td { padding: 4px 6px; border: 1px solid #cbd5e0; }
  .closing { margin-top: 30px; }
  .signature-block { margin-top: 40px; }
  .signature-line { border-top: 1px solid #1a1a1a; width: 250px; margin-top: 40px; padding-top: 4px; font-size: 9pt; }
  .footer { margin-top: 30px; padding-top: 8px; border-top: 1px solid #cbd5e0; font-size: 7.5pt; color: #718096; text-align: center; }
</style>
</head><body>

<div class="letterhead">
  <h1>${firm.firm_name || "FLORIDA PRIVATE PROVIDERS"}</h1>
  <p>LICENSED PRIVATE PROVIDER FIRM</p>
  <p class="license">License # ${firm.license_number || "PVP-XXXXX"} | F.S. 553.791</p>
  <p>Plan Review &bull; Inspections &bull; Code Compliance</p>
  ${firm.address ? `<p style="font-size:7.5pt;color:#718096;margin-top:2px">${firm.address}</p>` : ""}
  ${firm.phone || firm.email ? `<p style="font-size:7.5pt;color:#718096">${[firm.phone, firm.email].filter(Boolean).join(" | ")}</p>` : ""}
</div>

${config.buildingDepartment.address ? `
<div class="addressee">
  <strong>TO:</strong> ${config.buildingDepartment.officialTitle}<br/>
  ${config.buildingDepartment.name}<br/>
  ${config.buildingDepartment.address}
</div>` : ""}

<div class="header-info">
  <table>
    <tr><td>Date:</td><td>${date}</td></tr>
    <tr><td>Project:</td><td><strong>${projectName}</strong></td></tr>
    <tr><td>Address:</td><td>${address}</td></tr>
    <tr><td>County:</td><td>${config.label} County${config.hvhz ? ' (HVHZ)' : ''}</td></tr>
    <tr><td>Jurisdiction:</td><td>${jurisdiction || 'N/A'}</td></tr>
    <tr><td>Trade(s):</td><td style="text-transform:capitalize">${tradeType}</td></tr>
    <tr><td>Review Round:</td><td>#${round}</td></tr>
    <tr><td>Design Wind Speed:</td><td>${config.designWindSpeed}</td></tr>
    <tr><td>Permit Application #:</td><td>[TO BE ASSIGNED]</td></tr>
  </table>
</div>

${config.hvhz ? '<div class="hvhz-banner"><strong>HIGH VELOCITY HURRICANE ZONE (HVHZ)</strong> — Enhanced requirements per FBC 1626, Miami-Dade TAS 201/202/203 apply to this project.</div>' : ''}

${config.submissionNotes.length > 0 ? `
<div class="county-notes">
  <strong>${config.label} County Notes:</strong><br/>
  ${config.submissionNotes.map(n => `• ${n}`).join("<br/>")}
</div>` : ""}

<p class="body-text"><strong>RE: Plan Review Comment Letter — Round ${round}</strong></p>

<p class="body-text">Pursuant to Florida Statute 553.791, Florida Private Providers, Inc. has completed a plan review of the above-referenced project. The following deficiencies and comments have been identified during our review of the submitted construction documents against the Florida Building Code, 8th Edition (2023) and all applicable referenced standards${config.amendments.length > 0 ? `, including ${config.label} County local amendments` : ''}.</p>

<p class="body-text">This review was completed within the statutory 21-calendar-day review period. The applicant is required to address all deficiency items and resubmit corrected plans within <strong>${config.resubmissionDays} calendar days</strong>.</p>

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
  const countyAmendment = finding.county_specific && config.amendments.length > 0
    ? config.amendments[0]
    : null;
  return `
<div class="finding-item">
  <p>
    <span class="finding-number">${itemNumber}.</span>
    <span class="finding-severity sev-${finding.severity}">${finding.severity.toUpperCase()}</span>
    ${status !== 'open' ? `<span class="status-tag status-${status}">${status.toUpperCase()}</span>` : ''}
    ${finding.county_specific ? `<span class="county-flag"> [${config.label} County Amendment]</span>` : ''}
  </p>
  <p><span class="code-ref">${finding.code_ref}</span> — Sheet: ${finding.page}</p>
  ${finding.county_specific && countyAmendment ? `<p class="amendment-ref">Per ${countyAmendment.ref}: ${countyAmendment.description}</p>` : ""}
  <p>${finding.description}</p>
  <p class="recommendation"><strong>Required Action:</strong> ${finding.recommendation}</p>
</div>`;
}).join('')}`;
}).join('')}

${buildSupplementalSections(config)}

<div class="closing">
  <p class="body-text">All items marked as CRITICAL must be addressed prior to plan approval. Failure to resubmit corrected documents within the ${config.resubmissionDays}-day resubmission period may result in the review expiring, requiring a new application and review fees.</p>
  
  ${config.amendments.length > 0 ? `<p class="body-text">This review incorporates ${config.label} County local amendments to the Florida Building Code, 8th Edition (2023), including: ${config.amendments.map(a => a.ref).join("; ")}.</p>` : ""}
  
  ${firm.closing_language ? `<p class="body-text">${firm.closing_language}</p>` : '<p class="body-text">Should you have any questions regarding this comment letter, please contact our office at your earliest convenience.</p>'}
  
  <p class="body-text">Respectfully submitted,</p>
</div>

<div class="signature-block">
  <div class="signature-line">
    Plan Review Engineer<br>
    ${firm.firm_name || "Florida Private Providers, Inc."}<br>
    License # ${firm.license_number || "PVP-XXXXX"}
  </div>
</div>

<div class="footer">
  ${firm.firm_name || "Florida Private Providers, Inc."} | Licensed Private Provider under F.S. 553.791 | This document is confidential and intended for the addressee only.
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
