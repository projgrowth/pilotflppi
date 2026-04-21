import { printViaIframe } from "@/lib/print-utils";
import type {
  DeferredScopeItem,
  DeficiencyV2Row,
  ProjectDnaRow,
  SheetCoverageRow,
} from "@/hooks/useReviewDashboard";
import { DEFERRED_SCOPE_LABELS } from "@/hooks/useReviewDashboard";
import type { FirmSettings } from "@/hooks/useFirmSettings";
import type { ReviewStatus } from "@/lib/review-status";

// Alias kept for backwards compatibility — the canonical type lives in review-status.
export type ReportStatus = ReviewStatus;

export interface ReportProject {
  name: string;
  address: string;
  jurisdiction: string;
  county: string;
}

export interface CountyReportInput {
  status: ReportStatus;
  round: number;
  project: ReportProject;
  dna: ProjectDnaRow | null;
  sheets: SheetCoverageRow[];
  deficiencies: DeficiencyV2Row[];
  deferredItems?: DeferredScopeItem[];
  observations?: string[];
  firm: Pick<FirmSettings, "firm_name" | "license_number" | "email" | "phone" | "address"> | null;
  reviewer?: { name?: string | null; license?: string | null };
  generatedAt?: Date;
}

const STATUS_LABEL: Record<ReportStatus, string> = {
  approved: "APPROVED",
  approved_with_conditions: "APPROVED WITH CONDITIONS",
  revise_resubmit: "REVISE & RESUBMIT",
  incomplete: "INCOMPLETE — HUMAN REVIEW REQUIRED",
};

const STATUS_COLOR: Record<ReportStatus, string> = {
  approved: "#0f766e",
  approved_with_conditions: "#b45309",
  revise_resubmit: "#b91c1c",
  incomplete: "#475569",
};

// Sort buckets in the order the user requested:
// Life Safety → Permit Blocker → Liability → Medium → Low.
// "high" priority deficiencies that don't have any of the three flags
// fall into the Permit Blocker bucket since they are blocking issues.
type Bucket = "lifeSafety" | "permitBlocker" | "liability" | "medium" | "low";

const BUCKET_LABEL: Record<Bucket, string> = {
  lifeSafety: "Life Safety",
  permitBlocker: "Permit Blockers",
  liability: "Liability Flags",
  medium: "Medium Priority",
  low: "Low Priority",
};

function bucketOf(d: DeficiencyV2Row): Bucket {
  if (d.life_safety_flag) return "lifeSafety";
  if (d.permit_blocker || d.priority === "high") return "permitBlocker";
  if (d.liability_flag) return "liability";
  if (d.priority === "low") return "low";
  return "medium";
}

const BUCKET_ORDER: Bucket[] = [
  "lifeSafety",
  "permitBlocker",
  "liability",
  "medium",
  "low",
];

function esc(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function codeRefString(d: DeficiencyV2Row): string {
  const c = d.code_reference;
  if (!c) return "";
  const parts = [c.code, c.section, c.edition].filter(Boolean);
  return parts.join(" ");
}

const DNA_FIELDS: Array<{ key: keyof ProjectDnaRow; label: string; format?: (v: unknown) => string }> = [
  { key: "occupancy_classification", label: "Occupancy Classification" },
  { key: "construction_type", label: "Construction Type" },
  { key: "total_sq_ft", label: "Total Square Footage", format: (v) => (v ? `${Number(v).toLocaleString()} sf` : "") },
  { key: "stories", label: "Stories", format: (v) => (v ? String(v) : "") },
  { key: "is_high_rise", label: "High-Rise", format: (v) => (v ? "Yes" : "No") },
  { key: "has_mezzanine", label: "Mezzanine", format: (v) => (v ? "Yes" : "No") },
  { key: "mixed_occupancy", label: "Mixed Occupancy", format: (v) => (v ? "Yes" : "No") },
  { key: "fbc_edition", label: "FBC Edition" },
  { key: "jurisdiction", label: "Jurisdiction" },
  { key: "county", label: "County" },
  { key: "hvhz", label: "HVHZ", format: (v) => (v ? "Yes" : "No") },
  { key: "wind_speed_vult", label: "Wind Speed (Vult)", format: (v) => (v ? `${v} mph` : "") },
  { key: "exposure_category", label: "Exposure Category" },
  { key: "risk_category", label: "Risk Category" },
  { key: "flood_zone", label: "Flood Zone" },
  { key: "seismic_design_category", label: "Seismic Design Category" },
];

function renderDnaTable(dna: ProjectDnaRow | null): string {
  if (!dna) {
    return `<p class="muted">Project DNA has not been extracted for this review.</p>`;
  }
  const missing = new Set(dna.missing_fields ?? []);
  const ambiguous = new Set(dna.ambiguous_fields ?? []);
  const rows = DNA_FIELDS.map(({ key, label, format }) => {
    const raw = dna[key];
    let value = "";
    let badge = "";
    if (missing.has(String(key))) {
      value = `<span class="missing">MISSING</span>`;
    } else if (raw === null || raw === undefined || raw === "") {
      value = `<span class="missing">MISSING</span>`;
    } else {
      const formatted = format ? format(raw) : String(raw);
      value = esc(formatted || "");
    }
    if (ambiguous.has(String(key))) {
      badge = ` <span class="amb-badge">AMBIGUOUS</span>`;
    }
    return `<tr><th>${esc(label)}</th><td>${value}${badge}</td></tr>`;
  }).join("");
  return `<table class="kv">${rows}</table>`;
}

function renderSheetTable(sheets: SheetCoverageRow[]): string {
  if (!sheets.length) {
    return `<p class="muted">No sheets recorded.</p>`;
  }
  const rows = [...sheets]
    .sort((a, b) => a.sheet_ref.localeCompare(b.sheet_ref))
    .map((s) => {
      const status = s.status === "missing_critical"
        ? `<span class="status-bad">MISSING (CRITICAL)</span>`
        : s.status === "missing_minor"
          ? `<span class="status-warn">MISSING</span>`
          : s.status === "extra"
            ? `<span class="status-info">EXTRA</span>`
            : `<span class="status-ok">PRESENT</span>`;
      return `
        <tr>
          <td class="mono">${esc(s.sheet_ref)}</td>
          <td>${esc(s.sheet_title ?? "")}</td>
          <td>${esc(s.discipline ?? "")}</td>
          <td>${status}</td>
        </tr>`;
    })
    .join("");
  return `
    <table class="grid">
      <thead><tr><th>Sheet</th><th>Title</th><th>Discipline</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderDeficiencyCard(d: DeficiencyV2Row, idx: number): string {
  const flags: string[] = [];
  if (d.life_safety_flag) flags.push(`<span class="flag flag-ls">LIFE SAFETY</span>`);
  if (d.permit_blocker) flags.push(`<span class="flag flag-pb">PERMIT BLOCKER</span>`);
  if (d.liability_flag) flags.push(`<span class="flag flag-lb">LIABILITY</span>`);
  if (d.requires_human_review) flags.push(`<span class="flag flag-hr">HUMAN REVIEW</span>`);
  const code = codeRefString(d);
  const sheets = (d.sheet_refs ?? []).join(", ");
  const conf = typeof d.confidence_score === "number"
    ? `${Math.round(d.confidence_score * 100)}%`
    : "—";
  const evidence = (d.evidence ?? []).filter(Boolean);
  return `
    <div class="def">
      <div class="def-head">
        <div class="def-num">#${esc(d.def_number || String(idx + 1))}</div>
        <div class="def-title">${esc(d.discipline?.toUpperCase() ?? "")}${sheets ? ` · <span class="mono">${esc(sheets)}</span>` : ""}</div>
        <div class="def-flags">${flags.join(" ")}</div>
      </div>
      <div class="def-body">
        <p class="def-finding">${esc(d.finding)}</p>
        <p class="def-action"><strong>Required Action:</strong> ${esc(d.required_action)}</p>
        ${code ? `<p class="def-code"><strong>Code:</strong> <span class="mono">${esc(code)}</span></p>` : ""}
        ${evidence.length
          ? `<ul class="def-ev">${evidence.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>`
          : ""}
        <div class="def-meta">Confidence ${esc(conf)}${d.confidence_basis ? ` · ${esc(d.confidence_basis)}` : ""}</div>
      </div>
    </div>`;
}

function renderDeficiencies(defs: DeficiencyV2Row[]): string {
  if (!defs.length) {
    return `<p class="muted">No deficiencies recorded.</p>`;
  }
  const grouped: Record<Bucket, DeficiencyV2Row[]> = {
    lifeSafety: [],
    permitBlocker: [],
    liability: [],
    medium: [],
    low: [],
  };
  for (const d of defs) grouped[bucketOf(d)].push(d);

  return BUCKET_ORDER
    .filter((b) => grouped[b].length > 0)
    .map((b) => {
      const items = grouped[b]
        .map((d, i) => renderDeficiencyCard(d, i))
        .join("");
      return `
        <section class="bucket bucket-${b}">
          <h3>${esc(BUCKET_LABEL[b])} <span class="muted">(${grouped[b].length})</span></h3>
          ${items}
        </section>`;
    })
    .join("");
}

function renderObservations(obs: string[]): string {
  if (!obs.length) {
    return `<p class="muted">No general observations recorded.</p>`;
  }
  return `<ul class="obs">${obs.map((o) => `<li>${esc(o)}</li>`).join("")}</ul>`;
}

function renderDeferredScope(items: DeferredScopeItem[]): string {
  const visible = items.filter((i) => i.status !== "dismissed");
  if (!visible.length) {
    return `<p class="muted">No deferred-submittal items detected on the cover or general-notes sheets.</p>`;
  }
  const rows = visible.map((it) => {
    const label = DEFERRED_SCOPE_LABELS[it.category] ?? it.category;
    const sheets = it.sheet_refs.join(", ");
    const conf = typeof it.confidence_score === "number"
      ? `${Math.round(it.confidence_score * 100)}%`
      : "—";
    const evidence = it.evidence.filter(Boolean);
    return `
      <div class="def">
        <div class="def-head">
          <div class="def-title"><strong>${esc(label)}</strong>${sheets ? ` · <span class="mono">${esc(sheets)}</span>` : ""}</div>
          <div class="def-flags"><span class="flag flag-pb">DEFERRED</span></div>
        </div>
        <div class="def-body">
          <p class="def-finding">${esc(it.description)}</p>
          ${it.required_submittal ? `<p class="def-action"><strong>Required Submittal:</strong> ${esc(it.required_submittal)}</p>` : ""}
          ${it.responsible_party ? `<p class="def-code"><strong>Responsible:</strong> ${esc(it.responsible_party)}</p>` : ""}
          ${evidence.length ? `<ul class="def-ev">${evidence.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
          <div class="def-meta">Confidence ${esc(conf)} · Status: ${esc(it.status)}</div>
        </div>
      </div>`;
  }).join("");
  return rows;
}

function summarize(defs: DeficiencyV2Row[]) {
  let lifeSafety = 0;
  let permitBlocker = 0;
  let liability = 0;
  let medium = 0;
  let low = 0;
  for (const d of defs) {
    const b = bucketOf(d);
    if (b === "lifeSafety") lifeSafety++;
    else if (b === "permitBlocker") permitBlocker++;
    else if (b === "liability") liability++;
    else if (b === "medium") medium++;
    else if (b === "low") low++;
  }
  return { lifeSafety, permitBlocker, liability, medium, low };
}

export function buildCountyReportHtml(input: CountyReportInput): string {
  const generatedAt = input.generatedAt ?? new Date();
  const status = input.status;
  // Suppress overturned + superseded findings — they failed adversarial verification
  // or were merged as duplicates and must never reach the contractor / county.
  const overturnedCount = input.deficiencies.filter(
    (d) => (d as { verification_status?: string }).verification_status === "overturned",
  ).length;
  const visibleDefs = input.deficiencies.filter((d) => {
    const v = (d as { verification_status?: string }).verification_status;
    return v !== "overturned" && v !== "superseded";
  });
  const stats = summarize(visibleDefs);
  const expected = input.sheets.filter((s) => s.expected).length;
  const present = input.sheets.filter((s) => s.expected && s.status === "present").length;
  const firm = input.firm;
  const reviewerName = input.reviewer?.name ?? "________________________";
  const reviewerLicense = input.reviewer?.license ?? firm?.license_number ?? "________________";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Plan Review Report — ${esc(input.project.name)}</title>
<style>
  @page { size: Letter; margin: 0.75in; }
  * { box-sizing: border-box; }
  body {
    font-family: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #111827;
    font-size: 10.5pt;
    line-height: 1.45;
    margin: 0;
  }
  .mono { font-family: "IBM Plex Mono", "Menlo", monospace; }
  h1, h2, h3 { color: #0f172a; margin: 0 0 8px; }
  h1 { font-size: 22pt; letter-spacing: -0.01em; }
  h2 { font-size: 14pt; border-bottom: 2px solid #0f172a; padding-bottom: 4px; margin-top: 28px; }
  h3 { font-size: 11pt; margin-top: 16px; text-transform: uppercase; letter-spacing: 0.04em; color: #334155; }
  p { margin: 6px 0; }
  .muted { color: #64748b; }
  .cover {
    page-break-after: always;
    display: flex;
    flex-direction: column;
    height: 9.5in;
  }
  .cover-firm { font-size: 10pt; color: #475569; }
  .cover-firm strong { color: #0f172a; }
  .cover-title { margin-top: 36px; font-size: 28pt; font-weight: 700; line-height: 1.1; color: #0f172a; }
  .cover-sub { color: #475569; margin-top: 4px; }
  .cover-status {
    margin-top: 36px;
    padding: 18px 22px;
    border-radius: 8px;
    color: white;
    background: ${STATUS_COLOR[status]};
    font-size: 16pt;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .cover-meta { margin-top: 28px; font-size: 10.5pt; }
  .cover-meta th { text-align: left; color: #475569; font-weight: 500; padding-right: 16px; vertical-align: top; }
  .cover-meta td { padding-bottom: 4px; }
  .summary-grid {
    margin-top: 24px;
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 8px;
  }
  .stat {
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 10px 12px;
  }
  .stat .n { font-size: 18pt; font-weight: 700; color: #0f172a; line-height: 1; }
  .stat .l { font-size: 8pt; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; margin-top: 4px; }
  .footer-note {
    margin-top: auto;
    font-size: 8.5pt;
    color: #64748b;
    border-top: 1px solid #e2e8f0;
    padding-top: 8px;
  }
  table.kv { border-collapse: collapse; width: 100%; }
  table.kv th, table.kv td { border-bottom: 1px solid #e5e7eb; padding: 6px 8px; text-align: left; vertical-align: top; }
  table.kv th { width: 40%; color: #475569; font-weight: 500; }
  table.grid { border-collapse: collapse; width: 100%; font-size: 10pt; }
  table.grid th, table.grid td { border: 1px solid #e5e7eb; padding: 5px 8px; text-align: left; }
  table.grid th { background: #f1f5f9; color: #0f172a; }
  .missing { color: #b91c1c; font-weight: 600; letter-spacing: 0.04em; font-size: 9pt; }
  .amb-badge { background: #fef3c7; color: #92400e; padding: 1px 6px; border-radius: 4px; font-size: 8pt; font-weight: 600; margin-left: 6px; }
  .status-ok { color: #047857; font-weight: 600; }
  .status-bad { color: #b91c1c; font-weight: 600; }
  .status-warn { color: #b45309; font-weight: 600; }
  .status-info { color: #1d4ed8; font-weight: 600; }
  .bucket { margin-bottom: 14px; }
  .bucket-lifeSafety h3 { color: #b91c1c; }
  .bucket-permitBlocker h3 { color: #c2410c; }
  .bucket-liability h3 { color: #b45309; }
  .def { border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; margin: 8px 0; page-break-inside: avoid; }
  .def-head { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; border-bottom: 1px dashed #e2e8f0; padding-bottom: 6px; margin-bottom: 6px; }
  .def-num { font-family: "IBM Plex Mono", monospace; font-weight: 600; color: #0f172a; }
  .def-title { flex: 1; color: #334155; font-size: 9.5pt; letter-spacing: 0.04em; }
  .flag { font-size: 8pt; padding: 1px 6px; border-radius: 4px; font-weight: 600; letter-spacing: 0.03em; }
  .flag-ls { background: #fee2e2; color: #b91c1c; }
  .flag-pb { background: #ffedd5; color: #c2410c; }
  .flag-lb { background: #fef3c7; color: #92400e; }
  .flag-hr { background: #e0e7ff; color: #3730a3; }
  .def-finding { font-weight: 500; }
  .def-action { color: #0f172a; }
  .def-code { color: #475569; font-size: 9.5pt; }
  .def-ev { margin: 6px 0 4px 18px; color: #334155; font-size: 9.5pt; }
  .def-meta { margin-top: 4px; font-size: 8.5pt; color: #64748b; }
  .obs { margin: 6px 0 6px 18px; }
  .cert {
    margin-top: 18px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    padding: 14px;
    background: #f8fafc;
    font-size: 10pt;
  }
  .sig-row { display: flex; gap: 32px; margin-top: 28px; }
  .sig-row .sig { flex: 1; border-top: 1px solid #0f172a; padding-top: 4px; font-size: 9pt; color: #475569; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>

<!-- ========== SECTION 1: COVER + STATUS ========== -->
<section class="cover">
  <div class="cover-firm">
    ${firm?.firm_name ? `<strong>${esc(firm.firm_name)}</strong><br />` : ""}
    ${firm?.license_number ? `License #${esc(firm.license_number)}<br />` : ""}
    ${firm?.address ? `${esc(firm.address)}<br />` : ""}
    ${firm?.email ? `${esc(firm.email)}` : ""}${firm?.email && firm?.phone ? " · " : ""}${firm?.phone ? esc(firm.phone) : ""}
  </div>

  <div class="cover-title">Plan Review Report</div>
  <div class="cover-sub">Round ${esc(input.round)} · ${esc(fmtDate(generatedAt))}</div>

  <div class="cover-status">${STATUS_LABEL[status]}</div>

  <table class="cover-meta">
    <tr><th>Project</th><td>${esc(input.project.name)}</td></tr>
    <tr><th>Address</th><td>${esc(input.project.address)}</td></tr>
    <tr><th>Jurisdiction</th><td>${esc(input.project.jurisdiction)}</td></tr>
    <tr><th>County</th><td>${esc(input.project.county)}</td></tr>
  </table>

  <div class="summary-grid">
    <div class="stat"><div class="n">${stats.lifeSafety}</div><div class="l">Life Safety</div></div>
    <div class="stat"><div class="n">${stats.permitBlocker}</div><div class="l">Permit Blockers</div></div>
    <div class="stat"><div class="n">${stats.liability}</div><div class="l">Liability</div></div>
    <div class="stat"><div class="n">${stats.medium}</div><div class="l">Medium</div></div>
    <div class="stat"><div class="n">${stats.low}</div><div class="l">Low</div></div>
  </div>

  <div class="footer-note">
    This report is issued under Florida Statute §553.791 (Private Provider Plan Review).
    Generated by Florida Private Providers automated review platform with mandatory licensed-engineer sign-off.
  </div>
</section>

<!-- ========== SECTION 2: SHEET COVERAGE ========== -->
<h2>2. Sheet Coverage</h2>
<p class="muted">${present} of ${expected} expected sheets present.</p>
${renderSheetTable(input.sheets)}

<!-- ========== SECTION 3: PROJECT DNA ========== -->
<h2>3. Project DNA</h2>
${renderDnaTable(input.dna)}

<!-- ========== SECTION 4: DEFICIENCIES ========== -->
<h2>4. Deficiencies</h2>
<p class="muted">Sorted by priority: Life Safety → Permit Blockers → Liability → Medium → Low.</p>
${overturnedCount > 0 ? `<p class="muted" style="font-style: italic;">AI-verified findings only · ${overturnedCount} item${overturnedCount === 1 ? "" : "s"} overturned during internal verification.</p>` : ""}
${renderDeficiencies(visibleDefs)}

<!-- ========== SECTION 5: DEFERRED SCOPE ITEMS ========== -->
<h2>5. Deferred Scope Items</h2>
<p class="muted">Items the plans defer to a separate submittal package. Must be submitted, reviewed, and permitted prior to installation.</p>
${renderDeferredScope(input.deferredItems ?? [])}

<!-- ========== SECTION 6: OBSERVATIONS ========== -->
<h2>6. General Observations</h2>
${renderObservations(input.observations ?? [])}

<!-- ========== SECTION 7: CERTIFICATION ========== -->
<h2>7. Private Provider Certification</h2>
<div class="cert">
  <p>
    Pursuant to <strong>Florida Statute §553.791</strong>, the undersigned Private Provider
    has performed plan review of the construction documents identified in this report.
    The Private Provider attests that the plans, as reviewed and to the extent of the
    deficiencies and observations enumerated above, comply with the applicable provisions
    of the Florida Building Code 2023 (8th Edition) and any locally adopted amendments
    of <strong>${esc(input.project.jurisdiction || input.project.county)}</strong>.
  </p>
  <p>
    Items flagged as <strong>Life Safety</strong> or <strong>Permit Blockers</strong> must
    be resolved prior to permit issuance. Items flagged for <strong>Human Review</strong>
    require a licensed engineer's verification and are not certified by automated review alone.
  </p>
  <p class="muted">
    Issued ${esc(fmtDate(generatedAt))} · Round ${esc(input.round)} · Status: ${STATUS_LABEL[status]}.
  </p>
  <div class="sig-row">
    <div class="sig">
      ${esc(reviewerName)}<br />
      Private Provider, License #${esc(reviewerLicense)}
    </div>
    <div class="sig">
      Date<br />
      ${esc(fmtDate(generatedAt))}
    </div>
  </div>
</div>

</body>
</html>`;
}

export function generateCountyReport(input: CountyReportInput): void {
  const html = buildCountyReportHtml(input);
  const safeName = input.project.name.replace(/[^a-z0-9]+/gi, "_").slice(0, 40) || "report";
  printViaIframe(html, `${safeName}_R${input.round}_report.html`);
}
