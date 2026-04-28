// Seeds / refreshes a single fbc_code_sections row with real requirement
// text. Two modes:
//   - mode='ai'      → ask Lovable AI Gateway for the canonical FBC text
//                      (used to bulk-fill the ~70% stub library)
//   - mode='manual'  → admin pasted the verbatim text; just upsert it
//
// Admin-only. Designed to be called from the Settings → Code Library tab
// either one row at a time or in batch.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface SeedRequest {
  section: string;
  code?: string; // FBC, FBC-B, FBCR, etc. defaults FBC
  edition?: string; // defaults 8th
  mode?: "ai" | "manual";
  title?: string;
  requirement_text?: string;
  source_url?: string;
}

const SEED_SCHEMA = {
  name: "submit_canonical_section",
  description:
    "Return the canonical Florida Building Code section title, requirement text, and keywords for the requested section number. If you are not confident the section exists, set found=false and explain.",
  parameters: {
    type: "object",
    properties: {
      found: { type: "boolean" },
      title: { type: "string", description: "Section heading text, e.g. 'Means of Egress'." },
      requirement_text: {
        type: "string",
        description:
          "Verbatim or near-verbatim canonical requirement text — at least 200 characters. Do NOT paraphrase loosely. If unsure, leave empty and set found=false.",
      },
      keywords: {
        type: "array",
        items: { type: "string" },
        description: "5-12 short keywords/phrases reviewers would type to find this section.",
      },
      confidence_note: { type: "string" },
    },
    required: ["found", "keywords"],
    additionalProperties: false,
  },
} as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) return json({ error: "Unauthorized" }, 401);
    const userId = claimsData.claims.sub as string;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: isAdmin } = await admin.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) return json({ error: "Admin role required" }, 403);

    const body = (await req.json().catch(() => ({}))) as SeedRequest;
    const section = (body.section || "").trim();
    if (!section) return json({ error: "section required" }, 400);
    const code = (body.code || "FBC").trim().toUpperCase();
    const edition = (body.edition || "8th").trim();
    const mode = body.mode === "manual" ? "manual" : "ai";

    let title = body.title?.trim() || "";
    let requirementText = body.requirement_text?.trim() || "";
    let keywords: string[] = [];
    let confidenceNote = "";

    if (mode === "ai") {
      const result = await callAiSeed(code, edition, section);
      if (!result.found || !result.requirement_text || result.requirement_text.length < 120) {
        return json({
          error: "AI could not produce confident canonical text — supply manually.",
          ai_note: result.confidence_note ?? null,
        }, 422);
      }
      title = title || result.title || section;
      requirementText = result.requirement_text;
      keywords = (result.keywords ?? []).slice(0, 12).map((k) => k.slice(0, 60));
      confidenceNote = result.confidence_note ?? "";
    } else {
      if (!requirementText || requirementText.length < 60) {
        return json({ error: "requirement_text must be at least 60 chars in manual mode" }, 400);
      }
      if (!title) title = section;
      keywords = deriveKeywords(`${title} ${requirementText}`);
    }

    const upsertRow = {
      code,
      section,
      edition,
      title: title.slice(0, 300),
      requirement_text: requirementText.slice(0, 8000),
      keywords,
      source_url: body.source_url ?? null,
      updated_at: new Date().toISOString(),
    };

    // Find existing row by (code, section, edition).
    const { data: existing } = await admin
      .from("fbc_code_sections")
      .select("id")
      .eq("code", code)
      .eq("section", section)
      .eq("edition", edition)
      .maybeSingle();

    if (existing?.id) {
      const { error } = await admin
        .from("fbc_code_sections")
        .update(upsertRow)
        .eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await admin.from("fbc_code_sections").insert(upsertRow);
      if (error) throw error;
    }

    await admin.from("activity_log").insert({
      event_type: "canonical_seeded",
      description: `Seeded canonical ${code} ${section} (${edition}) via ${mode}.`,
      actor_id: userId,
      actor_type: "admin",
      metadata: { code, section, edition, mode, ai_note: confidenceNote },
    });

    // Tier 4: fire-and-forget refresh of embeddings. The clear_fbc_embedding
    // BEFORE-UPDATE trigger has already nulled this row's vector, so the
    // embed function will re-vectorize it (and any other unembedded rows it
    // can fit in one batch). We do not await — admins shouldn't wait on it.
    void admin.functions
      .invoke("embed-fbc-sections", { body: { limit: 25 } })
      .catch((e) =>
        console.warn("[seed-canonical-section] embed refresh skipped:", e),
      );

    return json({
      ok: true,
      code,
      section,
      edition,
      title: upsertRow.title,
      length: requirementText.length,
      keywords,
      ai_note: confidenceNote,
    });
  } catch (err) {
    console.error("[seed-canonical-section] error", err);
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});

async function callAiSeed(code: string, edition: string, section: string): Promise<{
  found: boolean;
  title?: string;
  requirement_text?: string;
  keywords?: string[];
  confidence_note?: string;
}> {
  const system =
    "You are a Florida Building Code librarian. Return canonical section text for the requested " +
    "section number. Do NOT invent sections. If you are not confident the section exists in the " +
    "specified edition, set found=false and leave requirement_text empty. When found, return text " +
    "as close to verbatim as you can recall — do not loosely paraphrase. Aim for 200-1500 chars.";
  const user =
    `Code: ${code}\nEdition: ${edition} edition Florida Building Code\nSection: ${section}\n\n` +
    `Return the canonical section title and requirement text via submit_canonical_section.`;

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-pro",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      tools: [{ type: "function", function: SEED_SCHEMA }],
      tool_choice: { type: "function", function: { name: SEED_SCHEMA.name } },
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`AI gateway ${resp.status}: ${t.slice(0, 200)}`);
  }
  const data = await resp.json();
  const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) throw new Error("AI returned no tool args");
  return JSON.parse(args);
}

function deriveKeywords(text: string): string[] {
  const stop = new Set([
    "the", "and", "for", "with", "shall", "must", "this", "that", "from", "into",
    "have", "been", "such", "when", "where", "which", "are", "any", "per",
  ]);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)) {
    if (tok.length < 4 || stop.has(tok)) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
    if (out.length >= 10) break;
  }
  return out;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
