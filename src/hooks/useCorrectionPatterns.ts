import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// New tables (correction_patterns, applied_corrections) aren't in the
// generated types.ts yet — cast to a loose client so writes typecheck.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db: any = supabase;

export type RejectionReason =
  | "shown_elsewhere"
  | "wrong_code_section"
  | "doesnt_apply"
  | "standard_detail_covers"
  | "code_outdated"
  | "other";

export const REJECTION_REASON_LABELS: Record<RejectionReason, string> = {
  shown_elsewhere: "Already shown elsewhere on the plan",
  wrong_code_section: "Wrong code section cited",
  doesnt_apply: "Doesn't apply to this occupancy / construction type",
  standard_detail_covers: "Standard detail covers it (typical at our firm)",
  code_outdated: "Code section is outdated / superseded",
  other: "Other",
};

export interface CorrectionPatternRow {
  id: string;
  firm_id: string | null;
  discipline: string;
  pattern_summary: string;
  original_finding: string;
  original_required_action: string;
  code_reference: { code?: string; section?: string; edition?: string } | null;
  rejection_reason: RejectionReason;
  reason_notes: string;
  occupancy_classification: string | null;
  construction_type: string | null;
  county: string | null;
  fbc_edition: string | null;
  rejection_count: number;
  confirm_count: number;
  last_seen_at: string;
  is_active: boolean;
  source_deficiency_id: string | null;
  source_plan_review_id: string | null;
  created_at: string;
  updated_at: string;
}

interface AppliedCorrectionRow {
  id: string;
  plan_review_id: string;
  pattern_id: string;
  discipline: string;
  pattern_summary: string;
  applied_at: string;
  pattern?: CorrectionPatternRow | null;
}

/** Patterns that were applied (suppressed) on this specific review. */
export function useAppliedCorrections(planReviewId?: string) {
  return useQuery({
    queryKey: ["applied_corrections", planReviewId],
    enabled: !!planReviewId,
    queryFn: async () => {
      const { data, error } = await db
        .from("applied_corrections")
        .select("*, pattern:correction_patterns(*)")
        .eq("plan_review_id", planReviewId!)
        .order("applied_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AppliedCorrectionRow[];
    },
  });
}

interface RecordPatternInput {
  planReviewId: string;
  deficiency: {
    id: string;
    discipline: string;
    finding: string;
    required_action: string;
    code_reference: { code?: string; section?: string; edition?: string } | null;
  };
  reason: RejectionReason;
  notes: string;
}

/**
 * Record a rejection as a learned pattern. If a near-duplicate already exists
 * for the same firm/discipline/code-section, increment its counter instead of
 * creating a new row.
 */
export async function recordCorrectionPattern(input: RecordPatternInput) {
  const { planReviewId, deficiency, reason, notes } = input;

  // Pull project DNA snapshot for matching context.
  const { data: dna } = await supabase
    .from("project_dna")
    .select("occupancy_classification, construction_type, county, fbc_edition")
    .eq("plan_review_id", planReviewId)
    .maybeSingle();

  const codeSection = deficiency.code_reference?.section ?? null;

  // De-dupe heuristic: same discipline, code section, and reason within firm scope (RLS).
  let existing: { id: string; rejection_count: number } | null = null;
  if (codeSection) {
    const { data } = await db
      .from("correction_patterns")
      .select("id, rejection_count")
      .eq("discipline", deficiency.discipline)
      .eq("rejection_reason", reason)
      .filter("code_reference->>section", "eq", codeSection)
      .maybeSingle();
    existing = (data ?? null) as { id: string; rejection_count: number } | null;
  }

  if (existing) {
    const { error } = await db
      .from("correction_patterns")
      .update({
        rejection_count: existing.rejection_count + 1,
        last_seen_at: new Date().toISOString(),
        reason_notes: notes || undefined,
        source_deficiency_id: deficiency.id,
        source_plan_review_id: planReviewId,
      })
      .eq("id", existing.id);
    if (error) throw error;
    return existing.id;
  }

  const summary = buildPatternSummary({
    finding: deficiency.finding,
    codeSection,
    occupancy: dna?.occupancy_classification ?? null,
    reason,
  });

  const { data: inserted, error } = await db
    .from("correction_patterns")
    .insert({
      discipline: deficiency.discipline,
      pattern_summary: summary,
      original_finding: deficiency.finding,
      original_required_action: deficiency.required_action,
      code_reference: deficiency.code_reference ?? {},
      rejection_reason: reason,
      reason_notes: notes ?? "",
      occupancy_classification: dna?.occupancy_classification ?? null,
      construction_type: dna?.construction_type ?? null,
      county: dna?.county ?? null,
      fbc_edition: dna?.fbc_edition ?? null,
      source_deficiency_id: deficiency.id,
      source_plan_review_id: planReviewId,
    })
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return (inserted as { id: string } | null)?.id ?? null;
}

export async function setPatternActive(patternId: string, active: boolean) {
  const { error } = await db
    .from("correction_patterns")
    .update({ is_active: active })
    .eq("id", patternId);
  if (error) throw error;
}

/**
 * Normalise a discipline label so AI-emitted variants ("Mechanical") match
 * stored ones ("MEP", "mechanical"). Without this, `recordPatternConfirmation`
 * silently misses 100% of MEP-class patterns.
 */
function normalizeDiscipline(raw: string): string[] {
  const t = raw.trim().toLowerCase();
  // Each input → the set of stored labels we should match against.
  const groups: Record<string, string[]> = {
    mechanical: ["mechanical", "mep", "hvac"],
    electrical: ["electrical", "mep"],
    plumbing: ["plumbing", "mep"],
    mep: ["mep", "mechanical", "electrical", "plumbing"],
    structural: ["structural", "struct"],
    architectural: ["architectural", "arch"],
    "fire protection": ["fire protection", "fire", "life safety"],
    fire: ["fire", "fire protection", "life safety"],
    "life safety": ["life safety", "fire", "fire protection"],
    accessibility: ["accessibility", "ada"],
    energy: ["energy", "energy code"],
    civil: ["civil", "site"],
    site: ["site", "civil"],
  };
  return groups[t] ?? [t];
}

/**
 * Record a reviewer CONFIRMATION as positive signal on any matching pattern.
 * When a reviewer confirms a finding that matches an existing correction pattern
 * (same discipline + code section), increment confirm_count so the reliability
 * score can counterweight rejection_count. Patterns with high confirm_count
 * relative to rejection_count should NOT be suppressed — they reflect real
 * deficiencies the AI correctly identifies.
 *
 * Call this alongside updating reviewer_disposition = 'confirm' on a deficiency.
 *
 * Returns the pattern id that was credited, or null if no match. Throws on
 * actual DB errors so callers can decide whether to surface them.
 */
export async function recordPatternConfirmation(input: {
  planReviewId: string;
  deficiency: {
    discipline: string;
    code_reference: { code?: string; section?: string; edition?: string } | null;
  };
}): Promise<string | null> {
  const codeSection = input.deficiency.code_reference?.section ?? null;
  if (!codeSection) return null; // can't match without a section anchor

  const disciplineCandidates = normalizeDiscipline(input.deficiency.discipline);

  // Find matching pattern: any discipline alias + same code section, active,
  // within firm scope via RLS. We pick the pattern with the highest
  // rejection_count so the most "trained" pattern gets the positive signal.
  const { data, error: selectErr } = await db
    .from("correction_patterns")
    .select("id, confirm_count, rejection_count")
    .in("discipline", disciplineCandidates)
    .filter("code_reference->>section", "eq", codeSection)
    .eq("is_active", true)
    .order("rejection_count", { ascending: false })
    .limit(1);

  if (selectErr) throw selectErr;
  const match = (data?.[0] ?? null) as {
    id: string;
    confirm_count: number;
    rejection_count: number;
  } | null;

  if (!match) return null; // genuinely new find, nothing to credit

  const { error } = await db
    .from("correction_patterns")
    .update({
      confirm_count: (match.confirm_count ?? 0) + 1,
      last_seen_at: new Date().toISOString(),
    })
    .eq("id", match.id);

  if (error) throw error;
  return match.id;
}

function buildPatternSummary(input: {
  finding: string;
  codeSection: string | null;
  occupancy: string | null;
  reason: RejectionReason;
}) {
  const finding = input.finding.length > 100 ? `${input.finding.slice(0, 97)}…` : input.finding;
  const ctx: string[] = [];
  if (input.occupancy) ctx.push(`${input.occupancy}-occupancy`);
  if (input.codeSection) ctx.push(`§${input.codeSection}`);
  const ctxStr = ctx.length ? ` (${ctx.join(" / ")})` : "";
  const reasonShort: Record<RejectionReason, string> = {
    shown_elsewhere: "shown elsewhere on plans",
    wrong_code_section: "wrong code section",
    doesnt_apply: "does not apply to this project type",
    standard_detail_covers: "covered by standard detail",
    code_outdated: "code section superseded",
    other: "rejected",
  };
  return `${finding}${ctxStr} → ${reasonShort[input.reason]}`;
}
