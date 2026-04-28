// Backfill / refresh embeddings for fbc_code_sections.
// POST { limit?: number, force?: boolean }
//   - limit: process at most N rows (default 100, max 500)
//   - force: re-embed even if embedded_at is set (default false)
// Uses OpenAI text-embedding-3-small (1536 dims) to match the existing
// flag_embeddings vector index dimensionality.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EMBED_MODEL = "text-embedding-3-small";

async function embed(text: string, apiKey: string): Promise<number[]> {
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const v = j?.data?.[0]?.embedding;
  if (!Array.isArray(v)) throw new Error("no embedding returned");
  return v;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(500, Math.max(1, Number(body.limit ?? 100)));
    const force = !!body.force;

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let q = admin
      .from("fbc_code_sections")
      .select("id, code, section, edition, title, requirement_text, keywords")
      .limit(limit);
    if (!force) q = q.is("embedded_at", null);

    const { data, error } = await q;
    if (error) throw error;
    const rows = data ?? [];

    let ok = 0;
    let failed = 0;
    const errors: Array<{ id: string; error: string }> = [];

    for (const row of rows) {
      try {
        // Rich text: title + section ID + body + keywords gives the embedder
        // multiple anchors so short/stub rows still produce useful vectors.
        const text = [
          `${row.code} ${row.section} ${row.edition}`,
          row.title,
          row.requirement_text,
          Array.isArray(row.keywords) ? row.keywords.join(", ") : "",
        ]
          .filter(Boolean)
          .join("\n")
          .slice(0, 8000);

        const v = await embed(text, apiKey);
        const { error: upErr } = await admin
          .from("fbc_code_sections")
          .update({
            // pgvector accepts the JSON array form via PostgREST
            embedding_vector: v as unknown as string,
            embedded_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        if (upErr) throw upErr;
        ok++;
      } catch (e) {
        failed++;
        errors.push({ id: row.id, error: e instanceof Error ? e.message : String(e) });
      }
    }

    return new Response(
      JSON.stringify({ requested: rows.length, embedded: ok, failed, errors: errors.slice(0, 10) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
