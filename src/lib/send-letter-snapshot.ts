/**
 * sendCommentLetter — single entry point for the "Mark sent" action on the
 * Review Dashboard. Writes an immutable row to comment_letter_snapshots
 * (frozen findings, frozen letterhead, frozen letter HTML), updates
 * plan_reviews.qc_status to "sent", and logs to activity_log.
 *
 * This is what makes a sent letter defensible: 6 months later, the row is
 * still there exactly as it went out — even if findings, firm letterhead, or
 * the editable letter draft have all been changed.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Finding } from "@/components/FindingCard";
import type { ReadinessResult } from "./letter-readiness";

export interface SendLetterArgs {
  planReviewId: string;
  projectId: string;
  round: number;
  /** Rendered letter HTML (the same string that would print). */
  letterHtml: string;
  /** Snapshot of findings AT SEND TIME — frozen JSON, not a live reference. */
  findings: Finding[];
  /** Snapshot of firm letterhead AT SEND TIME. */
  firmInfo: Record<string, unknown> | null;
  /** Recipient (contractor email or label). Optional, freeform. */
  recipient?: string;
  /** Readiness result at send time — kept verbatim for audit. */
  readiness: ReadinessResult;
  /** Required when the reviewer overrode a failing readiness check. */
  overrideReason?: string | null;
}

export interface SendLetterResult {
  snapshotId: string;
  sentAt: string;
}

export async function sendCommentLetter(
  args: SendLetterArgs,
): Promise<SendLetterResult> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) throw new Error("Not signed in");

  // Freeze the findings into a JSON-serializable shape with all the fields
  // that matter for an audit (status, evidence URL, citation grounding).
  const frozenFindings = args.findings.map((f) => ({
    finding_id: f.finding_id ?? null,
    severity: f.severity,
    discipline: f.discipline ?? null,
    code_ref: f.code_ref,
    page: f.page,
    description: f.description,
    recommendation: f.recommendation,
    confidence: f.confidence ?? null,
    county_specific: !!f.county_specific,
    evidence_crop_url: f.evidence_crop_url ?? null,
    crop_url: f.crop_url ?? null,
    reasoning: f.reasoning ?? null,
    prompt_version: f.prompt_version ?? null,
    model_version: f.model_version ?? null,
    resolved: !!f.resolved,
  }));

  const readinessSnapshot = {
    blocking_count: args.readiness.blockingCount,
    all_required_passing: args.readiness.allRequiredPassing,
    checks: args.readiness.checks.map((c) => ({
      id: c.id,
      severity: c.severity,
      required: c.required,
      title: c.title,
    })),
  };

  const insertRow = {
    plan_review_id: args.planReviewId,
    round: args.round,
    sent_by: userId,
    recipient: args.recipient ?? "",
    letter_html: args.letterHtml,
    findings_json: frozenFindings as unknown as Record<string, unknown>[],
    firm_info_json: (args.firmInfo ?? {}) as Record<string, unknown>,
    readiness_snapshot: readinessSnapshot as unknown as Record<string, unknown>,
    override_reasons: args.overrideReason ?? null,
  };
  const { data: snap, error: snapErr } = await supabase
    .from("comment_letter_snapshots")
    .insert([insertRow])
    .select("id, sent_at")
    .single();

  if (snapErr || !snap) {
    throw new Error(snapErr?.message || "Snapshot insert failed");
  }

  // Mark the live review as sent. We intentionally do NOT touch
  // comment_letter_draft so the editable text persists for re-export.
  await supabase
    .from("plan_reviews")
    .update({ qc_status: "sent" })
    .eq("id", args.planReviewId);

  await supabase.from("activity_log").insert({
    event_type: "letter_sent",
    description: `Comment letter Round ${args.round} sent to contractor${args.overrideReason ? " (with override)" : ""}`,
    project_id: args.projectId,
    actor_id: userId,
    actor_type: "user",
    metadata: {
      snapshot_id: snap.id,
      round: args.round,
      override: !!args.overrideReason,
    },
  });

  return { snapshotId: snap.id, sentAt: snap.sent_at };
}
