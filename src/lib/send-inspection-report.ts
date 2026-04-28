/**
 * Sprint 4 — sends an inspection report to the AHJ with chain-of-custody.
 *
 * Mirrors the letter-snapshot pattern from Sprint 3: hash the rendered HTML
 * at the moment of "Send", persist the snapshot with its SHA-256 into
 * `inspection_reports`, log the activity, and stamp `sent_to_ahj_at`.
 *
 * Photo refs are passed through verbatim — they were already hashed at upload
 * time by `inspection-photos.ts` callers.
 */

import { supabase } from "@/integrations/supabase/client";
import { sha256Hex } from "@/lib/file-hash";

export interface InspectionDeficiencyRow {
  description: string;
  code_reference?: string;
  severity?: "critical" | "major" | "minor";
}

export interface SendInspectionReportInput {
  reportId: string;
  projectId: string;
  recipient: string;
  reportHtml: string;
  readinessSnapshot: Record<string, unknown>;
}

export interface SendInspectionReportResult {
  reportId: string;
  htmlSha256: string;
  sentAt: string;
}

export async function sendInspectionReport(
  input: SendInspectionReportInput,
): Promise<SendInspectionReportResult> {
  if (!input.reportHtml || input.reportHtml.length < 100) {
    throw new Error("Report HTML is empty or too short to send.");
  }
  if (!input.recipient.trim()) {
    throw new Error("AHJ recipient is required.");
  }

  const htmlSha256 = await sha256Hex(input.reportHtml);
  const sentAt = new Date().toISOString();

  const { error: updateErr } = await supabase
    .from("inspection_reports")
    .update({
      report_html: input.reportHtml,
      report_html_sha256: htmlSha256,
      readiness_snapshot: input.readinessSnapshot,
      sent_to_ahj_at: sentAt,
      ahj_recipient: input.recipient.trim(),
    })
    .eq("id", input.reportId);

  if (updateErr) throw updateErr;

  await supabase.from("activity_log").insert({
    event_type: "inspection_report_sent",
    description: `Inspection report sent to ${input.recipient.trim()}`,
    project_id: input.projectId,
    actor_type: "user",
    actor_id: (await supabase.auth.getUser()).data.user?.id ?? null,
    metadata: { report_id: input.reportId, html_sha256: htmlSha256 },
  });

  return { reportId: input.reportId, htmlSha256, sentAt };
}
