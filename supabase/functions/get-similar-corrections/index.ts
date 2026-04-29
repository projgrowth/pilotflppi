import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const ALLOWED_ORIGINS = new Set<string>([
  "https://projgrowth.site",
  "https://www.projgrowth.site",
  "https://pilotflppi.lovable.app",
]);
const ALLOWED_ORIGIN_PATTERNS: RegExp[] = [
  /^https:\/\/[a-z0-9-]+\.lovable\.app$/i,
  /^https:\/\/[a-z0-9-]+\.sandbox\.lovable\.dev$/i,
  /^https:\/\/[a-z0-9-]+\.lovableproject\.com$/i,
  /^http:\/\/localhost(:\d+)?$/i,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/i,
];

function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = ALLOWED_ORIGINS.has(origin) || ALLOWED_ORIGIN_PATTERNS.some((p) => p.test(origin));
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "null",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Vary": "Origin",
  };
}

serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { query_text, limit = 5, firm_id } = await req.json();
    if (!query_text || typeof query_text !== "string") {
      return new Response(JSON.stringify({ error: "query_text required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const safeLimit = Math.min(Math.max(1, Number(limit) || 5), 20);
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

    // ── Vector path (preferred) ──────────────────────────────────────────────
    if (openaiKey) {
      const embResp = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: query_text,
        }),
      });

      if (embResp.ok) {
        const embData = await embResp.json();
        const vector: number[] = embData.data?.[0]?.embedding;

        if (vector) {
          const { data: matches, error: rpcErr } = await supabase.rpc(
            "match_correction_embeddings",
            {
              query_vector: JSON.stringify(vector),
              match_threshold: 0.70,
              match_count: safeLimit,
              p_firm_id: firm_id ?? null,
            },
          );

          if (!rpcErr && matches && matches.length > 0) {
            const ids = (matches as Array<{ correction_id: string; similarity: number }>)
              .map((m) => m.correction_id);

            const { data: corrections } = await supabase
              .from("corrections")
              .select(
                "id, original_value, corrected_value, fbc_section, context_notes, correction_type",
              )
              .in("id", ids);

            const scoreMap = new Map(
              (matches as Array<{ correction_id: string; similarity: number }>).map(
                (m) => [m.correction_id, m.similarity],
              ),
            );

            const result = (corrections || [])
              .map((c) => ({
                ...c,
                similarity: scoreMap.get(c.id) ?? 0,
              }))
              .sort((a, b) => b.similarity - a.similarity);

            return new Response(
              JSON.stringify({ corrections: result, method: "vector" }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
        }
      }
    }

    // ── Keyword fallback ─────────────────────────────────────────────────────
    let queryKeywords = query_text.toLowerCase();

    if (lovableApiKey) {
      const aiResp = await fetch(
        "https://ai.gateway.lovable.dev/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${lovableApiKey}`,
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              {
                role: "system",
                content:
                  "Extract 10-15 normalized keywords from this text for similarity matching. Return only comma-separated lowercase keywords.",
              },
              { role: "user", content: query_text },
            ],
            max_tokens: 200,
            temperature: 0,
          }),
        },
      );
      if (aiResp.ok) {
        const aiData = await aiResp.json();
        queryKeywords = aiData.choices?.[0]?.message?.content || queryKeywords;
      }
    }

    const { data: embeddings } = await supabase
      .from("flag_embeddings")
      .select("correction_id, embedding_keywords")
      .not("embedding_keywords", "is", null);

    if (!embeddings || embeddings.length === 0) {
      return new Response(
        JSON.stringify({ corrections: [], method: "keywords_empty" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const queryWords = new Set(
      queryKeywords.toLowerCase().split(/[,\s]+/).filter(Boolean),
    );

    const scored = embeddings
      .map((e) => {
        const embWords = new Set(
          (e.embedding_keywords || "").toLowerCase().split(/[,\s]+/).filter(Boolean),
        );
        let overlap = 0;
        for (const w of queryWords) if (embWords.has(w)) overlap++;
        const score = queryWords.size > 0 ? overlap / queryWords.size : 0;
        return { correction_id: e.correction_id, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, safeLimit);

    if (scored.length === 0) {
      return new Response(
        JSON.stringify({ corrections: [], method: "keywords_no_match" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const ids = scored.map((s) => s.correction_id).filter(Boolean);
    const { data: corrections } = await supabase
      .from("corrections")
      .select(
        "id, original_value, corrected_value, fbc_section, context_notes, correction_type",
      )
      .in("id", ids);

    const result = (corrections || [])
      .map((c) => ({
        ...c,
        similarity: scored.find((s) => s.correction_id === c.id)?.score || 0,
      }))
      .sort((a, b) => b.similarity - a.similarity);

    return new Response(
      JSON.stringify({ corrections: result, method: "keywords" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
