// Stage: discipline_review.
// The heart of the pipeline: per-discipline AI vision review against the
// title-block-routed sheets, layered with general-notes context, learned
// firm-specific correction patterns, and the deterministic
// discipline_negative_space checklist. Resumable via per-discipline chunk
// checkpoints and bounded by both a chunk-count ceiling and a soft 120s
// timeout that throws so the dispatcher's retry path picks back up cleanly.

import { composeDisciplineSystemPrompt } from "../discipline-experts.ts";

import { createClient } from "../_shared/supabase.ts";
import { callAI } from "../_shared/ai.ts";
import { embedText } from "../_shared/embedding.ts";
import { signedSheetUrls } from "../_shared/storage.ts";
import { recordPipelineError } from "../_shared/pipeline-status.ts";
import {
  DISCIPLINES,
  normalizeAIDiscipline,
  disciplineForSheetFallback,
  mapSeverityToPriority,
  canonicalDiscipline,
} from "../_shared/types.ts";

const FINDINGS_SCHEMA = {
  name: "submit_discipline_findings",
  description:
    "Return discipline-specific deficiencies grounded in visible evidence on the supplied plan sheets. If a required item is not visible, raise a deficiency with requires_human_review=true.",
  parameters: {
    type: "object",
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            finding: { type: "string" },
            required_action: { type: "string" },
            sheet_refs: { type: "array", items: { type: "string" } },
            code_section: { type: "string" },
            evidence: { type: "array", items: { type: "string" } },
            confidence_score: { type: "number", minimum: 0, maximum: 1 },
            confidence_basis: { type: "string" },
            life_safety_flag: { type: "boolean" },
            permit_blocker: { type: "boolean" },
            liability_flag: { type: "boolean" },
            requires_human_review: { type: "boolean" },
            human_review_reason: { type: "string" },
            human_review_verify: { type: "string" },
            priority: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: [
            "finding",
            "required_action",
            "sheet_refs",
            "evidence",
            "confidence_score",
            "confidence_basis",
            "priority",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["findings"],
    additionalProperties: false,
  },
} as const;

interface DisciplineRunCtx {
  discipline: string;
  disciplineSheets: Array<{ sheet_ref: string; sheet_title: string | null }>;
  disciplineImageUrls: string[];
  generalImageUrls: string[];
  dna: Record<string, unknown> | null;
  jurisdiction: Record<string, unknown> | null;
  useType: string | null;
  /** Disciplines absent from the submittal — passed through to the expert
   * prompt so it doesn't fabricate findings against missing trades. */
  missingDisciplines?: string[];
}

// Per-worker cache so we don't refetch the active prompt id once per chunk.
const _promptVersionCache = new Map<string, string | null>();

async function getActivePromptVersionId(
  admin: ReturnType<typeof createClient>,
  promptKey: string,
): Promise<string | null> {
  if (_promptVersionCache.has(promptKey)) {
    return _promptVersionCache.get(promptKey) ?? null;
  }
  const { data } = await admin
    .from("prompt_versions")
    .select("id")
    .eq("prompt_key", promptKey)
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const id = (data as { id?: string } | null)?.id ?? null;
  _promptVersionCache.set(promptKey, id);
  return id;
}

async function runDisciplineChecks(
  admin: ReturnType<typeof createClient>,
  planReviewId: string,
  firmId: string | null,
  ctx: DisciplineRunCtx,
): Promise<number> {
  const { data: items } = await admin
    .from("discipline_negative_space")
    .select("item_key, description, fbc_section, trigger_condition")
    .eq("discipline", ctx.discipline)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  const checklist = (items ?? []) as Array<{
    item_key: string;
    description: string;
    fbc_section: string | null;
    trigger_condition: string | null;
  }>;

  const dnaSummary = ctx.dna
    ? JSON.stringify(
        {
          occupancy: ctx.dna.occupancy_classification,
          construction_type: ctx.dna.construction_type,
          stories: ctx.dna.stories,
          total_sq_ft: ctx.dna.total_sq_ft,
          wind_speed_vult: ctx.dna.wind_speed_vult,
          exposure_category: ctx.dna.exposure_category,
          risk_category: ctx.dna.risk_category,
          flood_zone: ctx.dna.flood_zone,
          hvhz: ctx.dna.hvhz,
          mixed_occupancy: ctx.dna.mixed_occupancy,
          is_high_rise: ctx.dna.is_high_rise,
          has_mezzanine: ctx.dna.has_mezzanine,
          missing_fields: ctx.dna.missing_fields,
        },
        null,
        2,
      )
    : "(not yet extracted)";

  const jurSummary = ctx.jurisdiction
    ? JSON.stringify(
        {
          county: ctx.jurisdiction.county,
          fbc_edition: ctx.jurisdiction.fbc_edition,
          hvhz: ctx.jurisdiction.hvhz,
          coastal: ctx.jurisdiction.coastal,
          flood_zone_critical: ctx.jurisdiction.flood_zone_critical,
          high_volume: ctx.jurisdiction.high_volume,
          notes: ctx.jurisdiction.notes,
        },
        null,
        2,
      )
    : "(unknown jurisdiction)";

  const checklistText = checklist.length
    ? checklist
        .map(
          (c, i) =>
            `${i + 1}. [${c.item_key}] ${c.description}${
              c.fbc_section ? ` (FBC ${c.fbc_section})` : ""
            }${c.trigger_condition ? ` — only if: ${c.trigger_condition}` : ""}`,
        )
        .join("\n")
    : "(no checklist seeded — rely on discipline best practices)";

  const sheetIndex = ctx.disciplineSheets
    .map((s) => `${s.sheet_ref}${s.sheet_title ? ` — ${s.sheet_title}` : ""}`)
    .join("\n");

  // -------- Reviewer Memory: inject learned correction patterns --------
  const occupancy = (ctx.dna?.occupancy_classification as string | null) ?? null;
  const constructionType = (ctx.dna?.construction_type as string | null) ?? null;
  const fbcEdition = (ctx.dna?.fbc_edition as string | null) ?? null;
  let patternQuery = admin
    .from("correction_patterns")
    .select("id, pattern_summary, original_finding, code_reference, reason_notes, rejection_count, confirm_count, occupancy_classification, construction_type")
    .eq("discipline", ctx.discipline)
    .eq("is_active", true)
    .order("last_seen_at", { ascending: false })
    .limit(40);
  if (firmId) patternQuery = patternQuery.eq("firm_id", firmId);
  const { data: patternsData } = await patternQuery;
  const patterns = (patternsData ?? []) as Array<{
    id: string;
    pattern_summary: string;
    original_finding: string;
    code_reference: { section?: string } | null;
    reason_notes: string;
    rejection_count: number;
    confirm_count: number;
    occupancy_classification: string | null;
    construction_type: string | null;
  }>;
  const scored = patterns
    .map((p) => ({ ...p, score: (p.rejection_count ?? 0) - (p.confirm_count ?? 0) }))
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score);
  const relevantPatterns = scored.filter((p) =>
    (!p.occupancy_classification || p.occupancy_classification === occupancy) &&
    (!p.construction_type || p.construction_type === constructionType)
  ).slice(0, 12);

  // ---- Semantic recall: pull patterns by meaning, not just by section. ----
  // Builds a discipline + checklist signature, embeds it once per chunk, and
  // queries match_correction_patterns. De-duped against the section-keyed
  // results above so we don't double-list the same row in the prompt.
  const seenPatternIds = new Set(relevantPatterns.map((p) => p.id));
  const semanticPatterns: typeof relevantPatterns = [];
  try {
    const semanticSignature = `${ctx.discipline} review for ${occupancy ?? "unknown occupancy"} ${constructionType ?? ""} project. Common deficiencies: ${checklist.slice(0, 8).map((c) => c.description).join("; ")}`.slice(0, 1000);
    const queryVec = await embedText(semanticSignature);
    if (queryVec) {
      const { data: semData } = await admin.rpc("match_correction_patterns", {
        query_vector: queryVec as unknown as string,
        match_threshold: 0.72,
        match_count: 8,
        p_firm_id: firmId,
        p_discipline: ctx.discipline,
      });
      const semRows = (semData ?? []) as Array<{
        id: string;
        pattern_summary: string;
        original_finding: string;
        reason_notes: string;
        rejection_count: number;
        confirm_count: number;
        similarity: number;
      }>;
      for (const r of semRows) {
        if (seenPatternIds.has(r.id)) continue;
        // Reliability gate matches the section-keyed branch.
        if ((r.rejection_count ?? 0) - (r.confirm_count ?? 0) <= 0) continue;
        seenPatternIds.add(r.id);
        semanticPatterns.push({
          id: r.id,
          pattern_summary: r.pattern_summary,
          original_finding: r.original_finding,
          code_reference: null,
          reason_notes: r.reason_notes,
          rejection_count: r.rejection_count,
          confirm_count: r.confirm_count,
          occupancy_classification: null,
          construction_type: null,
          score: (r.rejection_count ?? 0) - (r.confirm_count ?? 0),
        });
      }
    }
  } catch (err) {
    console.warn("[discipline_review] semantic pattern recall failed (non-fatal):", err);
  }
  const allPatterns = [...relevantPatterns, ...semanticPatterns].slice(0, 16);

  const learnedText = allPatterns.length
    ? allPatterns
        .map(
          (p, i) =>
            `${i + 1}. ${p.pattern_summary}${p.reason_notes ? ` — Note: ${p.reason_notes}` : ""} (rejected ${p.rejection_count}× by senior reviewers)`,
        )
        .join("\n")
    : null;

  if (allPatterns.length) {
    await admin.from("applied_corrections").insert(
      allPatterns.map((p) => ({
        plan_review_id: planReviewId,
        firm_id: firmId,
        pattern_id: p.id,
        discipline: ctx.discipline,
        pattern_summary: p.pattern_summary,
      })),
    );
  }

  const memoryBlock = learnedText
    ? `\n\n## LEARNED CORRECTIONS — your firm's senior reviewers previously rejected these.
Do NOT re-flag these unless you have strong new evidence on the plans:
${learnedText}\n`
    : "";

  const systemPrompt = composeDisciplineSystemPrompt(ctx.discipline, {
    missingDisciplines: ctx.missingDisciplines,
  });

  const useTypeLine = ctx.useType === "residential"
    ? `## Project Use Type
RESIDENTIAL — apply FBC Residential (FBCR), NOT FBC Building. Skip commercial accessibility (FBC Ch.11). Use IRC/FBCR-style code references.

`
    : ctx.useType === "commercial"
      ? `## Project Use Type
COMMERCIAL — apply FBC Building (not FBCR). Accessibility (FBC Ch.11/ADA) and commercial life-safety apply.

`
      : "";

  const userText =
    useTypeLine +
    `## Project DNA
${dnaSummary}

` +
    `## Jurisdiction
${jurSummary}

` +
    `## Sheets routed to ${ctx.discipline}
${sheetIndex || "(none)"}

` +
    `## Mandatory ${ctx.discipline} checklist
${checklistText}` +
    memoryBlock +
    `\n\n## Citation discipline (HARD RULE)
Every finding MUST cite an FBC section you are confident exists in the Florida Building Code (e.g. "1010.1.1", "Table 1004.5"). If you are not sure the section exists or applies, do NOT guess — instead set requires_human_review=true with human_review_reason="Citation needs human verification". Hallucinated citations get auto-suppressed downstream and waste reviewer time.\n\n` +
    `Analyze the attached pages (general-notes pages first, then ${ctx.discipline} sheets). ` +
    `Return findings via submit_discipline_findings.`;

  void fbcEdition;

  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [
    { type: "text", text: userText },
    ...ctx.generalImageUrls.map((u) => ({
      type: "image_url" as const,
      image_url: { url: u },
    })),
    ...ctx.disciplineImageUrls.map((u) => ({
      type: "image_url" as const,
      image_url: { url: u },
    })),
  ];

  const result = (await callAI(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content },
    ],
    FINDINGS_SCHEMA as unknown as Record<string, unknown>,
  )) as {
    findings: Array<{
      finding: string;
      required_action: string;
      sheet_refs: string[];
      code_section?: string;
      evidence: string[];
      confidence_score: number;
      confidence_basis: string;
      life_safety_flag?: boolean;
      permit_blocker?: boolean;
      liability_flag?: boolean;
      requires_human_review?: boolean;
      human_review_reason?: string;
      human_review_verify?: string;
      priority: "high" | "medium" | "low";
    }>;
  };

  const findings = result?.findings ?? [];
  if (findings.length === 0) return 0;

  // -------- Tier 2.1: Self-critique pass --------
  // Re-show the same images to a cheap second model with the model's own
  // findings and ask it to label each {keep, weak, junk} with a reason.
  // This catches: (a) findings whose evidence quote isn't actually visible
  // on the supplied sheets, (b) findings that contradict context shown
  // elsewhere on the sheet, (c) generic boilerplate that didn't observe a
  // specific defect. We keep this lightweight (one call per chunk) so it
  // doesn't blow the chunk timeout.
  const SELF_CRITIQUE_SCHEMA = {
    name: "submit_self_critique",
    description:
      "For each draft finding, decide if it is grounded in what is actually visible on the supplied sheets.",
    parameters: {
      type: "object",
      properties: {
        verdicts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              index: { type: "integer", minimum: 0 },
              verdict: { type: "string", enum: ["keep", "weak", "junk"] },
              reason: { type: "string" },
            },
            required: ["index", "verdict", "reason"],
            additionalProperties: false,
          },
        },
      },
      required: ["verdicts"],
      additionalProperties: false,
    },
  } as const;

  const critiqueVerdicts = new Map<number, { verdict: "keep" | "weak" | "junk"; reason: string }>();
  if (findings.length > 0 && ctx.disciplineImageUrls.length > 0) {
    try {
      const draftSummary = findings
        .map((f, i) =>
          `#${i} [${f.priority}] sheets=${(f.sheet_refs ?? []).join(",") || "—"} cite=${f.code_section ?? "—"}\n` +
          `  finding: ${f.finding.slice(0, 240)}\n` +
          `  evidence: ${(f.evidence ?? []).slice(0, 2).map((e) => `"${e.slice(0, 140)}"`).join(" | ") || "(none)"}`,
        )
        .join("\n\n");
      const critiqueText =
        `You drafted ${findings.length} ${ctx.discipline} findings against these plan sheets. ` +
        `Re-examine the images. For each finding, decide:\n` +
        `- keep: defect is clearly visible AND the evidence quote is something a reader could find on the sheet.\n` +
        `- weak: defect is plausible but evidence quote is vague, generic, or only loosely supported by what's visible.\n` +
        `- junk: defect is not visible, evidence quote does not appear on the sheets, or the finding contradicts something visible (e.g. you flagged 'no occupant load shown' but a load IS shown).\n\n` +
        `Be honest. False positives waste reviewer time. Output one verdict per finding via submit_self_critique.\n\n` +
        `## Draft findings\n${draftSummary}`;
      const critiqueContent: Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      > = [
        { type: "text", text: critiqueText },
        ...ctx.disciplineImageUrls.slice(0, 8).map((u) => ({
          type: "image_url" as const,
          image_url: { url: u },
        })),
      ];
      const critiqueResult = (await callAI(
        [
          {
            role: "system",
            content:
              "You are a senior Florida plan reviewer auditing another reviewer's draft findings against the actual plan sheets. Reject anything not clearly visible.",
          },
          { role: "user", content: critiqueContent },
        ],
        SELF_CRITIQUE_SCHEMA as unknown as Record<string, unknown>,
        "google/gemini-2.5-flash",
      )) as {
        verdicts: Array<{ index: number; verdict: "keep" | "weak" | "junk"; reason: string }>;
      };
      for (const v of critiqueResult?.verdicts ?? []) {
        if (typeof v.index === "number" && v.index >= 0 && v.index < findings.length) {
          critiqueVerdicts.set(v.index, { verdict: v.verdict, reason: (v.reason ?? "").slice(0, 280) });
        }
      }
    } catch (err) {
      console.error("[discipline_review] self-critique failed (non-fatal):", err);
    }
  }

  const promptVersionId = await getActivePromptVersionId(admin, ctx.discipline);

  // Compute next def_number using MAX of existing rows for this
  // (plan_review, discipline) pair. Combined with the unique index on
  // (plan_review_id, def_number) and the upsert below, retries are idempotent.
  const canonicalSlug = canonicalDiscipline(ctx.discipline);
  const prefix = `DEF-${canonicalSlug.slice(0, 1).toUpperCase()}`;
  const { data: existingRows } = await admin
    .from("deficiencies_v2")
    .select("def_number")
    .eq("plan_review_id", planReviewId)
    .eq("discipline", canonicalSlug)
    .like("def_number", `${prefix}%`);
  let maxIdx = 0;
  for (const r of (existingRows ?? []) as Array<{ def_number: string }>) {
    const m = r.def_number?.match(/(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!isNaN(n) && n > maxIdx) maxIdx = n;
    }
  }
  const baseIdx = maxIdx + 1;

  // Server-side citation validator. The AI occasionally writes section
  // numbers in fake formats ("FBC 9999.99", "Chapter 6", random prose). Any
  // section that can't be normalized to a real-looking FBC code reference has
  // its code_reference blanked here so the grounder doesn't have to guess.
  // The shape we accept: optional letter prefix, 1–4 digits, up to four
  // dotted sub-parts, optional trailing letter. e.g. 1006.2.1, 508.4, R301.1
  const VALID_SECTION_RE = /^[A-Z]?\d{1,4}(\.\d{1,4}){0,4}[A-Za-z]?$/;
  const cleanSection = (raw: string | null | undefined): string | null => {
    if (!raw) return null;
    const stripped = raw
      .replace(/sec(?:tion)?\.?/i, "")
      .replace(/[§¶]/g, "")
      .replace(/^FBC[-\s]?[A-Z]?\s*/i, "")
      .trim()
      .split(/[,;]/)[0]
      .trim();
    if (!VALID_SECTION_RE.test(stripped)) return null;
    // Reject obviously fake numbers (FBC chapters max around 35 in any book).
    const major = parseInt(stripped.replace(/[^0-9]/g, "").slice(0, 4), 10);
    if (Number.isNaN(major) || major > 9000) return null;
    return stripped;
  };

  // Tier 2.2: the sheet refs we actually showed the model in this chunk.
  // Findings whose sheet_refs don't intersect this set are auto-suspicious —
  // the model invented a sheet number it never saw.
  const knownChunkSheets = new Set(
    ctx.disciplineSheets.map((s) => (s.sheet_ref ?? "").toUpperCase().trim()).filter(Boolean),
  );
  const verifyEvidenceShape = (
    evidence: string[],
    finding: string,
    sheetRefs: string[],
  ): { suspicious: boolean; reason: string } => {
    if (evidence.length === 0) {
      return { suspicious: true, reason: "no quoted evidence on the plan" };
    }
    // Sheet-anchor enforcement: the finding must name at least one sheet
    // we actually rendered for the model. Generic / fabricated sheet refs
    // (e.g. "A-999") are rejected at this gate.
    const claimedSheets = (sheetRefs ?? []).map((s) => (s ?? "").toUpperCase().trim()).filter(Boolean);
    if (claimedSheets.length === 0) {
      return { suspicious: true, reason: "no sheet_refs cited" };
    }
    if (knownChunkSheets.size > 0) {
      const anyKnown = claimedSheets.some((s) => knownChunkSheets.has(s));
      if (!anyKnown) {
        return {
          suspicious: true,
          reason: `cited sheet(s) ${claimedSheets.join(", ")} not in the chunk shown to the model (${[...knownChunkSheets].slice(0, 4).join(", ")}…)`,
        };
      }
    }
    const findingTokens = new Set(
      finding.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 4),
    );
    for (const e of evidence) {
      const eLow = e.toLowerCase();
      if (eLow.length < 8) {
        return { suspicious: true, reason: `evidence quote too short: "${e}"` };
      }
      // Restating the finding back as "evidence" is a hallucination tell.
      const eTokens = eLow.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 4);
      if (eTokens.length > 0) {
        const overlap = eTokens.filter((t) => findingTokens.has(t)).length;
        if (overlap / eTokens.length > 0.85 && eTokens.length >= 4) {
          return {
            suspicious: true,
            reason: "evidence quote restates the finding instead of quoting the plan",
          };
        }
      }
    }
    // Require at least one quote contain a known sheet ref OR a strong
    // plan-specific anchor (callout id, dimension, note number). Mere
    // generic words like "section" or "table" no longer satisfy.
    const STRONG_ANCHORS = [
      /\b[A-Z]{1,3}-?\d{1,3}\.\d{1,3}\b/, // detail callouts e.g. A5.2 or 1/A5.2
      /\b\d+\/[A-Z]{1,3}-?\d{1,4}\b/, // detail-of-sheet e.g. 3/A-501
      /\b\d+(?:\.\d+)?\s*(?:in|inch|inches|"|ft|feet|'|psf|°|deg|kips|psi)\b/i,
      /\bnote\s*\d+\b/i,
      /\bdetail\s*\d/i,
      /\btable\s+[A-Z0-9]/i,
    ];
    const sheetUpper = claimedSheets;
    const anyAnchor = evidence.some(
      (e) =>
        sheetUpper.some((s) => e.toUpperCase().includes(s)) ||
        STRONG_ANCHORS.some((re) => re.test(e)),
    );
    if (!anyAnchor) {
      return {
        suspicious: true,
        reason: "evidence has no strong plan anchor (sheet ref, detail callout, dimension, or numbered note)",
      };
    }
    return { suspicious: false, reason: "" };
  };

  // Hard-drop findings whose verbatim plan-evidence array is empty AFTER
  // cleaning. The prompt mandates `evidence[]`; an empty array means the model
  // gave up and "hallucinated by omission." Keeping these poisons the comment
  // letter (no quote a building official can verify on the sheet). Life-safety
  // / permit-blocker items are kept but flagged for mandatory human review so
  // catastrophic risks don't silently disappear.
  const filteredFindings = findings.filter((f) => {
    const cleaned = (f.evidence ?? [])
      .map((s) => (typeof s === "string" ? s.trim() : ""))
      .filter((s) => s.length > 0);
    if (cleaned.length > 0) return true;
    return !!f.life_safety_flag || !!f.permit_blocker;
  });
  const droppedNoEvidence = findings.length - filteredFindings.length;
  if (droppedNoEvidence > 0) {
    console.log(
      `[discipline-review] dropped ${droppedNoEvidence}/${findings.length} findings with no verbatim plan evidence`,
    );
  }

  const rows = filteredFindings.map((f, i) => {
    const validSection = cleanSection(f.code_section);
    const cleanedEvidence = (f.evidence ?? [])
      .slice(0, 3)
      .map((s) => (typeof s === "string" ? s.slice(0, 200) : ""))
      .filter((s) => s.length > 0);
    const evidenceCheck = verifyEvidenceShape(
      cleanedEvidence,
      f.finding,
      f.sheet_refs ?? [],
    );
    const critique = critiqueVerdicts.get(i);
    const isJunk = critique?.verdict === "junk";
    const isWeak = critique?.verdict === "weak";

    // Self-critique 'junk' → auto-waive (still stored for audit).
    // Self-critique 'weak' → require human review with the model's reason.
    // Evidence-shape suspicious → require human review (existing Tier 1 behavior).
    const baseConf = Math.max(0, Math.min(1, f.confidence_score ?? 0.5));
    let adjustedConf = baseConf;
    if (isJunk) adjustedConf = Math.min(adjustedConf, 0.15);
    else if (isWeak) adjustedConf = Math.max(0.1, baseConf * 0.5);
    else if (evidenceCheck.suspicious) adjustedConf = Math.max(0.1, baseConf * 0.6);

    const requiresHumanReview =
      !!f.requires_human_review || evidenceCheck.suspicious || isWeak || isJunk;
    const humanReviewReason = isJunk
      ? `Self-critique rejected: ${critique?.reason ?? "not visible on plan"}`
      : isWeak
        ? `Self-critique flagged weak: ${critique?.reason ?? "evidence weak"}`
        : evidenceCheck.suspicious
          ? `Evidence verification: ${evidenceCheck.reason}. Confirm finding on the plan.`
          : f.human_review_reason ?? null;
    const status = isJunk ? "waived" : "open";

    return {
      plan_review_id: planReviewId,
      firm_id: firmId,
      def_number: `${prefix}${String(baseIdx + i).padStart(3, "0")}`,
      discipline: canonicalSlug,
      sheet_refs: f.sheet_refs ?? [],
      code_reference: validSection
        ? { code: "FBC", section: validSection, edition: ctx.dna?.fbc_edition ?? "8th" }
        : {},
      finding: f.finding,
      required_action: f.required_action,
      evidence: cleanedEvidence,
      evidence_crop_meta: {
        evidence_check: {
          suspicious: evidenceCheck.suspicious,
          reason: evidenceCheck.reason,
          checked_at: new Date().toISOString(),
        },
        self_critique: critique
          ? { verdict: critique.verdict, reason: critique.reason }
          : null,
      },
      priority: f.priority ?? "medium",
      life_safety_flag: !!f.life_safety_flag,
      permit_blocker: !!f.permit_blocker,
      liability_flag: !!f.liability_flag,
      requires_human_review: requiresHumanReview,
      human_review_reason: humanReviewReason,
      human_review_verify: f.human_review_verify ?? null,
      confidence_score: adjustedConf,
      confidence_basis: f.confidence_basis ?? "Vision-extracted",
      model_version: "google/gemini-2.5-flash",
      prompt_version_id: promptVersionId,
      status,
    };
  });


  const { error } = await admin
    .from("deficiencies_v2")
    .upsert(rows, { onConflict: "plan_review_id,def_number", ignoreDuplicates: true });
  if (error) throw error;
  return rows.length;
}

export async function stageDisciplineReview(
  admin: ReturnType<typeof createClient>,
  planReviewId: string,
  firmId: string | null,
) {
  const [sheets, signedUrls, dnaRow, jurisdictionRow, reviewMetaRow, progressRow] = await Promise.all([
    admin
      .from("sheet_coverage")
      .select("sheet_ref, sheet_title, discipline, page_index")
      .eq("plan_review_id", planReviewId)
      .order("page_index", { ascending: true }),
    signedSheetUrls(admin, planReviewId),
    admin
      .from("project_dna")
      .select("*")
      .eq("plan_review_id", planReviewId)
      .maybeSingle(),
    admin
      .from("plan_reviews")
      .select("projects(county, use_type)")
      .eq("id", planReviewId)
      .maybeSingle(),
    admin
      .from("plan_reviews")
      .select("round, previous_findings, checklist_state, stage_checkpoints")
      .eq("id", planReviewId)
      .maybeSingle(),
    admin
      .from("plan_reviews")
      .select("ai_run_progress")
      .eq("id", planReviewId)
      .maybeSingle(),
  ]);

  // Pull the missing-disciplines list written by the submittal-check stage
  // so each discipline expert can avoid fabricating findings against trades
  // that aren't in the submittal.
  const _runProgress = ((progressRow.data as { ai_run_progress?: Record<string, unknown> | null } | null)?.ai_run_progress ?? {}) as Record<string, unknown>;
  const missingDisciplines: string[] = Array.isArray(_runProgress.submittal_missing_disciplines)
    ? (_runProgress.submittal_missing_disciplines as unknown[]).filter((x): x is string => typeof x === "string")
    : [];

  // Stage start timestamp for the soft mid-stage timeout safety net.
  // Tightened from 120s → 90s now that chunks run in parallel batches of 3 —
  // a full discipline rarely needs more than ~45s, so 90s leaves headroom
  // without lingering in the dead zone before the dispatcher takes over.
  const stageStartedAt = Date.now();
  const STAGE_SOFT_TIMEOUT_MS = 90_000;

  // Hard stall watchdog: if no progress beacon has been written for this long,
  // assume the worker is wedged (Gemini hung, gateway stuck, etc.) and bail.
  // The dispatcher's NON_FATAL_RETRY_STAGES path will reschedule automatically
  // and the per-discipline checkpoints make the retry resume from where we
  // left off rather than restart.
  const STALL_TIMEOUT_MS = 120_000;
  let lastBeaconAt = Date.now();

  // How many chunks per discipline run concurrently. 3 is the sweet spot:
  // - high enough to crush a 10-chunk Architectural set in ~3 vision rounds
  //   (~30-45s vs ~100-150s sequentially)
  // - low enough to stay under the Lovable AI Gateway burst tier and keep
  //   the edge function comfortably below its 150s budget.
  const CHUNK_CONCURRENCY = 3;

  // Helper: write a live "we're on chunk N of M" beacon to ai_run_progress
  // so the UI can render sub-stage progress and the watchdog can tell the
  // worker apart from a true hang. Best-effort — never throws.
  const writeChunkProgress = async (args: {
    discipline: string;
    chunk: number;
    total: number;
    findingsSoFar: number;
  }) => {
    try {
      const { data: cur } = await admin
        .from("plan_reviews")
        .select("ai_run_progress")
        .eq("id", planReviewId)
        .maybeSingle();
      const prev =
        ((cur as { ai_run_progress?: Record<string, unknown> | null } | null)
          ?.ai_run_progress ?? {}) as Record<string, unknown>;
      await admin
        .from("plan_reviews")
        .update({
          ai_run_progress: {
            ...prev,
            discipline_review_progress: {
              discipline: args.discipline,
              chunk: args.chunk,
              total: args.total,
              findings_so_far: args.findingsSoFar,
              last_chunk_at: new Date().toISOString(),
            },
          },
        })
        .eq("id", planReviewId);
      lastBeaconAt = Date.now();
    } catch (err) {
      console.error("[discipline_review] progress write failed:", err);
    }
  };

  // `lastBeaconAt` is initialized at stage start; every successful wave
  // refreshes it via writeChunkProgress(). The watchdog below trips if no
  // beacon lands within STALL_TIMEOUT_MS.

  // Resumable chunk checkpoints. `stage_checkpoints.discipline_review` is a
  // map of `{ [discipline]: lastChunkCompleted }`. On retry we skip every
  // chunk index up to and including the saved value.
  const checkpointsRow = (reviewMetaRow.data ?? null) as
    | { stage_checkpoints?: Record<string, unknown> | null }
    | null;
  const allCheckpoints = (checkpointsRow?.stage_checkpoints ?? {}) as Record<
    string,
    Record<string, number>
  >;
  const disciplineCheckpoints: Record<string, number> = {
    ...((allCheckpoints.discipline_review ?? {}) as Record<string, number>),
  };
  const persistDisciplineCheckpoint = async (discipline: string, chunkIdx: number) => {
    disciplineCheckpoints[discipline] = chunkIdx;
    const next = {
      ...allCheckpoints,
      discipline_review: { ...disciplineCheckpoints },
    };
    await admin
      .from("plan_reviews")
      .update({ stage_checkpoints: next })
      .eq("id", planReviewId);
  };

  const allSheets = (sheets.data ?? []) as Array<{
    sheet_ref: string;
    sheet_title: string | null;
    discipline: string | null;
    page_index: number | null;
  }>;

  // Round-2 diff intelligence — carryover unchanged-sheet findings rather
  // than burning AI calls on them.
  const reviewMeta = (reviewMetaRow.data ?? null) as
    | { round: number; previous_findings: unknown; checklist_state: Record<string, unknown> | null }
    | null;
  const round = reviewMeta?.round ?? 1;
  const checklistState = (reviewMeta?.checklist_state ?? {}) as Record<string, unknown>;
  const lastSheetMap =
    Array.isArray(checklistState.last_sheet_map) ? (checklistState.last_sheet_map as Array<{
      sheet_ref: string;
      page_index: number | null;
      discipline: string | null;
    }>) : null;
  const priorFindings: Array<Record<string, unknown>> = Array.isArray(reviewMeta?.previous_findings)
    ? (reviewMeta!.previous_findings as Array<Record<string, unknown>>)
    : [];

  const unchangedSheetRefs = new Set<string>();
  if (round >= 2 && lastSheetMap && lastSheetMap.length > 0) {
    const priorByRef = new Map(lastSheetMap.map((p) => [p.sheet_ref, p]));
    for (const s of allSheets) {
      const prior = priorByRef.get(s.sheet_ref);
      if (
        prior &&
        prior.page_index === s.page_index &&
        (prior.discipline ?? "") === (s.discipline ?? "")
      ) {
        unchangedSheetRefs.add(s.sheet_ref);
      }
    }
  }

  let carryoverInserted = 0;
  if (unchangedSheetRefs.size > 0 && priorFindings.length > 0) {
    const carryRows: Array<Record<string, unknown>> = [];
    for (const pf of priorFindings) {
      const page = typeof pf.page === "string" ? pf.page : "";
      const firstSheet = page.split(",")[0]?.trim() ?? "";
      if (!firstSheet || !unchangedSheetRefs.has(firstSheet)) continue;
      const desc = typeof pf.description === "string" ? pf.description : "";
      const codeRef = typeof pf.code_ref === "string" ? pf.code_ref : "";
      const discipline = typeof pf.discipline === "string" ? pf.discipline : "Architectural";
      carryRows.push({
        plan_review_id: planReviewId,
        firm_id: firmId,
        def_number: `CARRY-R${round - 1}-${carryRows.length + 1}`,
        discipline,
        finding: desc.slice(0, 2000) || "Carried over from prior round",
        required_action: typeof pf.recommendation === "string" ? pf.recommendation.slice(0, 2000) : "Verify resolution.",
        priority: typeof pf.severity === "string" ? mapSeverityToPriority(pf.severity) : "medium",
        sheet_refs: [firstSheet],
        code_reference: codeRef ? { section: codeRef } : {},
        evidence: [],
        status: "open",
        verification_status: "carryover",
        verification_notes: `Sheet ${firstSheet} unchanged from round ${round - 1}; finding replayed without re-review.`,
        evidence_crop_meta: { carryover_from_round: round - 1, source_sheet: firstSheet },
      });
    }
    if (carryRows.length > 0) {
      const { error: cErr } = await admin.from("deficiencies_v2").insert(carryRows);
      if (cErr) {
        console.error("[discipline_review] carryover insert failed:", cErr);
      } else {
        carryoverInserted = carryRows.length;
      }
    }
  }

  const dna = (dnaRow.data ?? null) as Record<string, unknown> | null;
  const jurisdictionProject = (jurisdictionRow.data ?? null) as
    | { projects: { county: string; use_type: string | null } | null }
    | null;
  const county = jurisdictionProject?.projects?.county ?? null;
  const useType = jurisdictionProject?.projects?.use_type ?? null;

  let jurisdiction: Record<string, unknown> | null = null;
  if (county) {
    const { data: jr } = await admin
      .from("jurisdictions_fl")
      .select("*")
      .eq("county", county)
      .maybeSingle();
    jurisdiction = (jr ?? null) as Record<string, unknown> | null;
  }

  const disciplinesToRun = useType === "residential"
    ? DISCIPLINES.filter((d) => d !== "Accessibility")
    : DISCIPLINES;

  type RoutedSheet = {
    sheet_ref: string;
    sheet_title: string | null;
    page_index: number | null;
    discipline: string | null;
  };
  const routed: RoutedSheet[] = allSheets.map((s) => {
    const aiResolved = normalizeAIDiscipline(s.discipline);
    const fallback = aiResolved === null ? disciplineForSheetFallback(s.sheet_ref) : null;
    return {
      sheet_ref: s.sheet_ref,
      sheet_title: s.sheet_title,
      page_index: s.page_index,
      discipline: aiResolved ?? fallback,
    };
  });

  // First 2 "general notes" pages seed every call.
  const generalSheets = routed.filter((s) => s.discipline === null).slice(0, 2);
  const generalImageUrls = generalSheets
    .map((s) => signedUrls[s.page_index ?? -1]?.signed_url)
    .filter(Boolean) as string[];

  const failed: string[] = [];
  let totalFindings = 0;

  const DISCIPLINE_BATCH = 8;
  const MAX_SHEETS_PER_DISCIPLINE = 200;
  const MAX_CHUNKS_PER_DISCIPLINE = 18;

  const byDiscipline: Record<string, { reviewed: number; total: number }> = {};
  let cappedAt: number | null = null;

  const checkCancelled = async (): Promise<boolean> => {
    const { data } = await admin
      .from("plan_reviews")
      .select("ai_run_progress")
      .eq("id", planReviewId)
      .maybeSingle();
    const progress =
      (data as { ai_run_progress?: Record<string, unknown> | null } | null)
        ?.ai_run_progress ?? {};
    return typeof progress.cancelled_at === "string" && progress.cancelled_at.length > 0;
  };

  let cancelledMidRun = false;

  for (const discipline of disciplinesToRun) {
    if (cancelledMidRun) break;
    try {
      const disciplineSheets = routed.filter(
        (s) => s.discipline === discipline && !unchangedSheetRefs.has(s.sheet_ref),
      );
      const allUrls = disciplineSheets
        .map((s) => signedUrls[s.page_index ?? -1]?.signed_url)
        .filter(Boolean) as string[];

      const totalForDiscipline = routed.filter((s) => s.discipline === discipline).length;
      byDiscipline[discipline] = { reviewed: totalForDiscipline - disciplineSheets.length, total: totalForDiscipline };

      if (allUrls.length === 0) continue;

      const cappedUrls = allUrls.slice(0, MAX_SHEETS_PER_DISCIPLINE);
      if (allUrls.length > MAX_SHEETS_PER_DISCIPLINE) {
        cappedAt = MAX_SHEETS_PER_DISCIPLINE;
      }

      let disciplineFindings = 0;
      let chunksRun = 0;
      let lastReviewedSheets = 0;
      const totalChunks = Math.ceil(cappedUrls.length / DISCIPLINE_BATCH);
      const resumeFrom = disciplineCheckpoints[discipline] ?? -1;
      if (resumeFrom >= 0) {
        await recordPipelineError(admin, {
          planReviewId,
          firmId,
          stage: "discipline_review",
          errorClass: "chunk_resume",
          errorMessage: `${discipline}: resuming after chunk ${resumeFrom + 1}/${totalChunks} (skipping prior chunks).`,
          metadata: { discipline, resume_after_chunk: resumeFrom + 1, total_chunks: totalChunks },
        });
      }
      // Build the list of chunk indexes we still need to run (skip resumed
      // and any beyond the per-discipline ceiling).
      const pendingChunks: number[] = [];
      for (let cs = 0; cs < cappedUrls.length; cs += DISCIPLINE_BATCH) {
        const chunkIdx = Math.floor(cs / DISCIPLINE_BATCH);
        if (chunkIdx <= resumeFrom) {
          chunksRun++;
          lastReviewedSheets = Math.min(cs + DISCIPLINE_BATCH, cappedUrls.length);
          continue;
        }
        if (chunkIdx >= MAX_CHUNKS_PER_DISCIPLINE) break;
        pendingChunks.push(chunkIdx);
      }

      // Track contiguous completion so the resume checkpoint stays correct
      // even when chunks finish out of order.
      const completedSet = new Set<number>();
      let highestContiguous = resumeFrom;
      const advanceContiguous = async () => {
        let advanced = false;
        while (completedSet.has(highestContiguous + 1)) {
          highestContiguous += 1;
          advanced = true;
        }
        if (advanced) await persistDisciplineCheckpoint(discipline, highestContiguous);
      };

      let failedChunks = 0;
      const totalPending = pendingChunks.length;

      // Process chunks in waves of CHUNK_CONCURRENCY.
      outer: for (let waveStart = 0; waveStart < pendingChunks.length; waveStart += CHUNK_CONCURRENCY) {
        if (await checkCancelled()) {
          cancelledMidRun = true;
          break outer;
        }
        if (Date.now() - stageStartedAt > STAGE_SOFT_TIMEOUT_MS) {
          const nextChunk = pendingChunks[waveStart];
          await recordPipelineError(admin, {
            planReviewId,
            firmId,
            stage: "discipline_review",
            errorClass: "soft_timeout",
            errorMessage: `${discipline}: paused at chunk ${nextChunk + 1}/${totalChunks} after ${Math.round((Date.now() - stageStartedAt) / 1000)}s — will resume on next dispatcher tick.`,
            metadata: { discipline, paused_at_chunk: nextChunk + 1, total_chunks: totalChunks, elapsed_ms: Date.now() - stageStartedAt },
          });
          throw new Error(`SOFT_TIMEOUT: discipline_review paused at ${discipline} chunk ${nextChunk + 1}/${totalChunks}`);
        }

        const wave = pendingChunks.slice(waveStart, waveStart + CHUNK_CONCURRENCY);
        const waveStartedAt = Date.now();

        // Hard stall watchdog: race the wave against STALL_TIMEOUT_MS. If no
        // chunk in the wave settles in 2 minutes (and no beacon was written
        // in that window), assume the worker is wedged. Throwing here lands
        // in the dispatcher's NON_FATAL_RETRY path which reschedules the
        // stage; per-discipline checkpoints make the retry resume from the
        // last contiguous chunk rather than restart from zero.
        let stallTimer: ReturnType<typeof setTimeout> | undefined;
        const stallPromise = new Promise<never>((_, reject) => {
          stallTimer = setTimeout(() => {
            const sinceBeacon = Date.now() - lastBeaconAt;
            if (sinceBeacon >= STALL_TIMEOUT_MS) {
              reject(
                new Error(
                  `STALL_TIMEOUT: ${discipline} chunk ${(wave[0] ?? 0) + 1}/${totalChunks} produced no progress for ${Math.round(sinceBeacon / 1000)}s`,
                ),
              );
            } else {
              // A beacon landed mid-wave — not actually stalled. Resolve the
              // race with a never-fulfilling promise; allSettled wins below.
              // (This branch is rare since beacons are written *after* waves.)
              reject(new Error("STALL_FALSE_POSITIVE"));
            }
          }, STALL_TIMEOUT_MS);
        });

        let settled: PromiseSettledResult<{ chunkIdx: number; cs: number; chunkSheets: typeof disciplineSheets; inserted: number }>[];
        try {
          settled = await Promise.race([
            Promise.allSettled(
              wave.map(async (chunkIdx) => {
                const cs = chunkIdx * DISCIPLINE_BATCH;
                const chunkUrls = cappedUrls.slice(cs, cs + DISCIPLINE_BATCH);
                const chunkSheets = disciplineSheets.slice(cs, cs + DISCIPLINE_BATCH);
                const inserted = await runDisciplineChecks(admin, planReviewId, firmId, {
                  discipline,
                  disciplineSheets: chunkSheets,
                  disciplineImageUrls: chunkUrls,
                  generalImageUrls,
                  dna,
                  jurisdiction,
                  useType,
                  missingDisciplines,
                });
                return { chunkIdx, cs, chunkSheets, inserted };
              }),
            ),
            stallPromise,
          ]);
        } catch (stallErr) {
          if (stallTimer) clearTimeout(stallTimer);
          const message = stallErr instanceof Error ? stallErr.message : String(stallErr);
          if (message === "STALL_FALSE_POSITIVE") {
            // Treat as soft retry — re-throw STALL_TIMEOUT so dispatcher retries.
            await recordPipelineError(admin, {
              planReviewId,
              firmId,
              stage: "discipline_review",
              errorClass: "stall_timeout",
              errorMessage: `${discipline}: wave at chunk ${(wave[0] ?? 0) + 1}/${totalChunks} did not complete in ${Math.round((Date.now() - waveStartedAt) / 1000)}s — auto-retrying with resume.`,
              metadata: { discipline, wave_start_chunk: (wave[0] ?? 0) + 1, total_chunks: totalChunks, elapsed_ms: Date.now() - waveStartedAt },
            });
            throw new Error(`STALL_TIMEOUT: ${discipline} wave at chunk ${(wave[0] ?? 0) + 1}/${totalChunks}`);
          }
          await recordPipelineError(admin, {
            planReviewId,
            firmId,
            stage: "discipline_review",
            errorClass: "stall_timeout",
            errorMessage: message,
            metadata: { discipline, wave_start_chunk: (wave[0] ?? 0) + 1, total_chunks: totalChunks, elapsed_ms: Date.now() - waveStartedAt },
          });
          throw stallErr;
        }
        if (stallTimer) clearTimeout(stallTimer);

        for (let i = 0; i < settled.length; i++) {
          const r = settled[i];
          const chunkIdx = wave[i];
          if (r.status === "fulfilled") {
            const { cs, chunkSheets, inserted } = r.value;
            disciplineFindings += inserted;
            chunksRun++;
            lastReviewedSheets = Math.max(lastReviewedSheets, cs + chunkSheets.length);
            completedSet.add(chunkIdx);
            await recordPipelineError(admin, {
              planReviewId,
              firmId,
              stage: "discipline_review",
              errorClass: "chunk_summary",
              errorMessage: `${discipline}: chunk ${chunkIdx + 1}/${totalChunks} → ${inserted} finding${inserted === 1 ? "" : "s"} (sheets ${cs + 1}-${cs + chunkSheets.length}).`,
              metadata: { discipline, chunk: chunkIdx + 1, total_chunks: totalChunks, findings: inserted },
            });
          } else {
            failedChunks++;
            await recordPipelineError(admin, {
              planReviewId,
              firmId,
              stage: "discipline_review",
              errorClass: "chunk_failed",
              errorMessage: `${discipline}: chunk ${chunkIdx + 1}/${totalChunks} failed — ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
              metadata: { discipline, chunk: chunkIdx + 1, total_chunks: totalChunks },
            });
          }
        }

        await advanceContiguous();
        // Live UI beacon: how many chunks are done in this discipline so far.
        await writeChunkProgress({
          discipline,
          chunk: completedSet.size + Math.max(0, resumeFrom + 1),
          total: totalChunks,
          findingsSoFar: disciplineFindings,
        });

        // A discipline fails the stage only if >50% of pending chunks errored.
        if (totalPending > 0 && failedChunks > totalPending / 2) {
          throw new Error(`${discipline}: ${failedChunks}/${totalPending} chunks failed — bailing out.`);
        }
      }
      totalFindings += disciplineFindings;
      byDiscipline[discipline].reviewed = byDiscipline[discipline].reviewed + lastReviewedSheets;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // Bubble watchdog/timeout errors to the dispatcher so it reschedules
      // the whole stage with resume — don't degrade the discipline to a
      // human-review placeholder.
      if (errMsg.startsWith("STALL_TIMEOUT") || errMsg.startsWith("SOFT_TIMEOUT")) {
        throw err;
      }
      console.error(`[discipline_review:${discipline}] failed:`, err);
      failed.push(discipline);
      await admin.from("deficiencies_v2").insert({
        plan_review_id: planReviewId,
        firm_id: firmId,
        def_number: `DEF-HR-${discipline.replace(/\s+/g, "").slice(0, 6).toUpperCase()}`,
        discipline,
        finding: `${discipline} review could not complete automatically.`,
        required_action: `Reviewer must perform ${discipline} review manually.`,
        priority: "medium",
        requires_human_review: true,
        human_review_reason: `Automated ${discipline} discipline check failed after retries.`,
        human_review_method: "Full manual discipline review using checklist.",
        status: "open",
      });
    }
  }

  if (cancelledMidRun) {
    const partialTotal = Object.values(byDiscipline).reduce((s, v) => s + v.total, 0);
    const partialReviewed = Object.values(byDiscipline).reduce((s, v) => s + v.reviewed, 0);
    try {
      await admin.from("review_coverage").upsert(
        {
          plan_review_id: planReviewId,
          firm_id: firmId,
          sheets_total: partialTotal,
          sheets_reviewed: partialReviewed,
          by_discipline: byDiscipline,
          capped_at: cappedAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "plan_review_id" },
      );
    } catch (err) {
      console.error("[discipline_review] failed to persist partial review_coverage:", err);
    }
    throw new Error("Cancelled by user");
  }

  const sheetsTotal = Object.values(byDiscipline).reduce((s, v) => s + v.total, 0);
  const sheetsReviewed = Object.values(byDiscipline).reduce((s, v) => s + v.reviewed, 0);
  try {
    await admin
      .from("review_coverage")
      .upsert(
        {
          plan_review_id: planReviewId,
          firm_id: firmId,
          sheets_total: sheetsTotal,
          sheets_reviewed: sheetsReviewed,
          by_discipline: byDiscipline,
          capped_at: cappedAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "plan_review_id" },
      );
  } catch (err) {
    console.error("[discipline_review] failed to persist review_coverage:", err);
  }

  // Stage finished cleanly — clear discipline checkpoints so a future re-run
  // starts fresh.
  if (Object.keys(disciplineCheckpoints).length > 0) {
    const cleared = { ...allCheckpoints };
    delete (cleared as Record<string, unknown>).discipline_review;
    await admin
      .from("plan_reviews")
      .update({ stage_checkpoints: cleared })
      .eq("id", planReviewId);
  }

  // LOW_YIELD guard: a multi-page review that produced 0 findings is almost
  // certainly a bad rasterize → empty DNA → AI saw nothing pattern. Refuse to
  // mark complete; surface as needs_human_review for manual disposition.
  const expectedPages = allSheets.length;
  if (totalFindings === 0 && carryoverInserted === 0 && expectedPages > 5 && failed.length === 0) {
    const reason = `Pipeline produced 0 findings on ${expectedPages} sheets. Likely a bad upload or empty rasterize — please review manually.`;
    await admin
      .from("plan_reviews")
      .update({
        ai_check_status: "needs_human_review",
        ai_run_progress: {
          failure_reason: reason,
          low_yield_at: new Date().toISOString(),
          expected_pages: expectedPages,
          total_findings: 0,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", planReviewId);
    await recordPipelineError(admin, {
      planReviewId,
      firmId,
      stage: "discipline_review",
      errorClass: "LOW_YIELD_REVIEW",
      errorMessage: reason,
      metadata: { expected_pages: expectedPages, sheets: allSheets.length },
    });
    throw new Error(`LOW_YIELD_REVIEW: ${reason}`);
  }

  return {
    failed_disciplines: failed,
    total_findings: totalFindings,
    carryover_inserted: carryoverInserted,
    unchanged_sheets: unchangedSheetRefs.size,
    round,
  };
}
