/**
 * Send the comment letter to the contractor / AHJ.
 *
 * What this actually does (the legitimacy contract):
 *  1. Writes an immutable row to `comment_letter_snapshots` capturing exactly
 *     what the user is sending — letter HTML, the live findings JSON, firm
 *     info JSON, the readiness checklist snapshot, any override reasons, and
 *     SHA-256 hashes so we can prove later what the AHJ actually received.
 *  2. Flips the project status to `comments_sent` (auto-pauses the statutory
 *     clock via the `auto_manage_statutory_clock` trigger).
 *  3. Logs `letter_sent` to activity_log for the audit trail.
 *
 * Without ALL THREE writes, every "Mark sent" before today was theatre — there
 * was no record of what we delivered or when the clock paused.
 */

import { supabase } from "@/integrations/supabase/client";
import { sha256Hex } from "@/lib/file-hash";
import type { ReadinessResult } from "@/lib/letter-readiness";

export interface SendCommentLetterArgs {
  planReviewId: string;
  projectId: string;
  round: number;
  recipient: string;
  letterHtml: string;
  findings: Array<Record<string, unknown>>;
  firmInfo: Record<string, unknown>;
  readiness: ReadinessResult;
  /** When the readiness gate has blockers and the reviewer chose Send Anyway,
   *  this MUST contain a typed reason. Empty string is treated as no override. */
  overrideReason?: string;
  sentByUserId: string;
  firmId: string | null;
}

export interface SendCommentLetterResult {
  snapshotId: string;
  letterHtmlSha256: string;
}

export async function sendCommentLetter(
  args: SendCommentLetterArgs,
): Promise<SendCommentLetterResult> {
  // 1. Hash the letter so the snapshot is provably the same bytes we sent.
  const letterHtmlSha256 = await sha256Hex(args.letterHtml ?? "");

  // 2. Persist the immutable snapshot first. If this throws we never
  // change project status — half-sent letters are worse than not sent.
  const { data: snap, error: snapErr } = await supabase
    .from("comment_letter_snapshots")
    .insert({
      plan_review_id: args.planReviewId,
      firm_id: args.firmId,
      round: args.round,
      sent_by: args.sentByUserId,
      recipient: args.recipient.slice(0, 500),
      letter_html: args.letterHtml,
      letter_html_sha256: letterHtmlSha256,
      findings_json: args.findings as unknown as object,
      firm_info_json: args.firmInfo as unknown as object,
      readiness_snapshot: {
        all_required_passing: args.readiness.allRequiredPassing,
        blocking_count: args.readiness.blockingCount,
        checks: args.readiness.checks.map((c) => ({
          id: c.id,
          required: c.required,
          severity: c.severity,
          title: c.title,
        })),
      } as unknown as object,
      override_reasons:
        args.overrideReason && args.overrideReason.trim().length > 0
          ? args.overrideReason.trim().slice(0, 2000)
          : null,
    })
    .select("id")
    .single();
  if (snapErr || !snap) {
    throw new Error(`Failed to create letter snapshot: ${snapErr?.message ?? "unknown"}`);
  }
  const snapshotId = snap.id as string;

  // 3. Flip project status — the DB trigger pauses the statutory clock.
  const { error: projErr } = await supabase
    .from("projects")
    .update({ status: "comments_sent" })
    .eq("id", args.projectId);
  if (projErr) {
    throw new Error(`Snapshot saved but status update failed: ${projErr.message}`);
  }

  // 4. Activity log — covers both the send and any override that bypassed
  // the readiness gate. Two rows is fine; they share metadata.
  await supabase.from("activity_log").insert({
    event_type: "letter_sent",
    description: `Comment letter (round ${args.round}) sent to ${args.recipient}`,
    project_id: args.projectId,
    actor_id: args.sentByUserId,
    actor_type: "user",
    firm_id: args.firmId,
    metadata: {
      plan_review_id: args.planReviewId,
      snapshot_id: snapshotId,
      letter_html_sha256: letterHtmlSha256,
      readiness_blocking_count: args.readiness.blockingCount,
      override_used:
        !!args.overrideReason && args.overrideReason.trim().length > 0,
    },
  });

  if (args.overrideReason && args.overrideReason.trim().length > 0) {
    await supabase.from("activity_log").insert({
      event_type: "readiness_override",
      description: `Reviewer overrode ${args.readiness.blockingCount} readiness blocker(s) when sending letter`,
      project_id: args.projectId,
      actor_id: args.sentByUserId,
      actor_type: "user",
      firm_id: args.firmId,
      metadata: {
        plan_review_id: args.planReviewId,
        snapshot_id: snapshotId,
        reason: args.overrideReason.trim().slice(0, 2000),
        failed_checks: args.readiness.checks
          .filter((c) => c.required && c.severity === "block")
          .map((c) => c.id),
      },
    });
  }

  return { snapshotId, letterHtmlSha256 };
}
