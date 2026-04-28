/**
 * Florida F.S. 553.791(10) Certificate of Compliance generator.
 *
 * The private provider issues this document to the AHJ once every required
 * inspection has passed. The AHJ uses it to issue the building's
 * Certificate of Occupancy.
 *
 * The integrity device here is a Merkle-style chained SHA-256 over the
 * sorted (by performed_at, id) inspection-report hashes. Any tampering with
 * any underlying inspection-report row invalidates the chained hash and the
 * certificate is provably no longer authentic.
 */

import { sha256Hex } from "@/lib/file-hash";

export interface CocInspectionInput {
  id: string;
  inspection_type: string;
  performed_at: string;
  inspector_license: string;
  inspector_name: string;
  result: "pass" | "fail" | "partial" | "na";
  /** SHA-256 of the rendered HTML report — required to enter the chain. */
  report_html_sha256: string | null;
}

export interface CocReadinessGap {
  inspection_type: string;
  reason: string;
}

export interface CocReadiness {
  ready: boolean;
  gaps: CocReadinessGap[];
  /** Sorted, pass-only reports that will compose the chain when ready. */
  eligibleReports: CocInspectionInput[];
}

export function evaluateCocReadiness(reports: CocInspectionInput[]): CocReadiness {
  const gaps: CocReadinessGap[] = [];
  const eligible: CocInspectionInput[] = [];

  for (const r of reports) {
    if (r.result !== "pass") {
      gaps.push({ inspection_type: r.inspection_type, reason: `Result is "${r.result}", must be pass` });
      continue;
    }
    if (!r.report_html_sha256) {
      gaps.push({ inspection_type: r.inspection_type, reason: "Report not snapshotted (no SHA-256)" });
      continue;
    }
    if (!r.inspector_license || r.inspector_license.trim().length === 0) {
      gaps.push({ inspection_type: r.inspection_type, reason: "Inspector license missing" });
      continue;
    }
    eligible.push(r);
  }

  eligible.sort((a, b) => {
    const ta = new Date(a.performed_at).getTime();
    const tb = new Date(b.performed_at).getTime();
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });

  return { ready: gaps.length === 0, gaps, eligibleReports: eligible };
}

/**
 * Compute a chained SHA-256 over the sorted report hashes:
 *   h_0 = sha256("")
 *   h_n = sha256(h_{n-1} || report_html_sha256_n)
 * This is order-sensitive (sorted by performed_at, id) so reordering or
 * substituting any entry invalidates it.
 */
export async function computeChainedHash(reports: CocInspectionInput[]): Promise<string> {
  let chain = await sha256Hex("");
  for (const r of reports) {
    chain = await sha256Hex(chain + (r.report_html_sha256 ?? ""));
  }
  return chain;
}

export interface CocAttestationInput {
  attestor_name: string;
  attestor_license: string;
  /** What the attestor typed verbatim — must contain "I attest". */
  typed_attestation: string;
}

export function validateAttestation(input: CocAttestationInput): { ok: true } | { ok: false; reason: string } {
  if (!input.attestor_name.trim()) return { ok: false, reason: "Attestor name required" };
  if (!input.attestor_license.trim()) return { ok: false, reason: "Attestor license required" };
  if (!/i\s+attest/i.test(input.typed_attestation)) {
    return { ok: false, reason: 'Attestation must include the phrase "I attest"' };
  }
  return { ok: true };
}

export interface CertificateRenderInput {
  project: { name: string; address: string; jurisdiction: string; county: string };
  firm: { firm_name: string; license_number: string; address: string } | null;
  attestor: { name: string; license: string };
  reports: CocInspectionInput[];
  chainedHash: string;
  issuedAt: Date;
  attestationText: string;
}

export function renderCertificateHtml(input: CertificateRenderInput): string {
  const rows = input.reports
    .map(
      (r) => `
        <tr>
          <td>${escapeHtml(r.inspection_type)}</td>
          <td>${new Date(r.performed_at).toLocaleDateString()}</td>
          <td>${escapeHtml(r.inspector_name)} (${escapeHtml(r.inspector_license)})</td>
          <td><code style="font-size:9px;">${escapeHtml((r.report_html_sha256 ?? "").slice(0, 16))}…</code></td>
        </tr>`,
    )
    .join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"/><title>Certificate of Compliance — ${escapeHtml(input.project.name)}</title>
<style>
  body { font-family: 'IBM Plex Sans', -apple-system, sans-serif; color: #0f172a; padding: 48px; max-width: 820px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px 0; letter-spacing: 0.5px; }
  .sub { color: #475569; font-size: 12px; margin-bottom: 32px; }
  .panel { border: 1px solid #cbd5e1; border-radius: 8px; padding: 16px 20px; margin-bottom: 20px; }
  .panel h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: #475569; margin: 0 0 8px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e2e8f0; }
  th { background: #f8fafc; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b; }
  .chain { font-family: 'IBM Plex Mono', monospace; background: #0f172a; color: #e2e8f0; padding: 12px 16px; border-radius: 6px; word-break: break-all; font-size: 11px; }
  .attest { background: #f0fdf4; border-left: 4px solid #16a34a; padding: 14px 18px; border-radius: 4px; font-size: 13px; }
  .meta { font-size: 11px; color: #64748b; margin-top: 32px; }
</style></head>
<body>
  <h1>CERTIFICATE OF COMPLIANCE</h1>
  <div class="sub">Issued under Florida Statutes § 553.791(10) — Private Provider Final Compliance Attestation</div>

  <div class="panel">
    <h2>Project</h2>
    <div><strong>${escapeHtml(input.project.name)}</strong></div>
    <div>${escapeHtml(input.project.address)}</div>
    <div>${escapeHtml(input.project.jurisdiction)}, ${escapeHtml(input.project.county)} County, Florida</div>
  </div>

  <div class="panel">
    <h2>Private Provider</h2>
    <div><strong>${escapeHtml(input.firm?.firm_name ?? "")}</strong></div>
    <div>License: ${escapeHtml(input.firm?.license_number ?? "")}</div>
    <div>${escapeHtml(input.firm?.address ?? "")}</div>
  </div>

  <div class="panel">
    <h2>Inspections of Record</h2>
    <table>
      <thead><tr><th>Inspection</th><th>Date</th><th>Inspector / License</th><th>Report SHA-256</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>

  <div class="panel">
    <h2>Tamper-evident Chained Hash</h2>
    <div class="chain">${escapeHtml(input.chainedHash)}</div>
    <div style="font-size:10px;color:#64748b;margin-top:8px;">
      SHA-256 fold over the inspection-report hashes above, ordered by performed_at then id.
      Any modification to any underlying report invalidates this value.
    </div>
  </div>

  <div class="attest">
    ${escapeHtml(input.attestationText)}
    <div style="margin-top:10px;font-weight:600;">
      ${escapeHtml(input.attestor.name)} — License ${escapeHtml(input.attestor.license)}
    </div>
    <div style="font-size:11px;color:#475569;margin-top:2px;">
      Attested ${input.issuedAt.toLocaleString()}
    </div>
  </div>

  <div class="meta">
    Generated ${input.issuedAt.toISOString()} • Certificate ID embedded in delivery metadata.
  </div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
