import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { query_text, limit = 5 } = await req.json();
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

    // Use Lovable AI to generate keywords for the query
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    let queryKeywords = query_text.toLowerCase();

    if (lovableApiKey) {
      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${lovableApiKey}`,
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          messages: [
            {
              role: "system",
              content: "Extract 10-15 normalized keywords from this text for similarity matching. Return only comma-separated lowercase keywords.",
            },
            { role: "user", content: query_text },
          ],
          max_tokens: 200,
          temperature: 0,
        }),
      });

      if (aiResp.ok) {
        const aiData = await aiResp.json();
        queryKeywords = aiData.choices?.[0]?.message?.content || queryKeywords;
      }
    }

    // Fetch all embeddings and corrections
    const { data: embeddings } = await supabase
      .from("flag_embeddings")
      .select("correction_id, embedding")
      .not("embedding", "is", null);

    if (!embeddings || embeddings.length === 0) {
      return new Response(JSON.stringify({ corrections: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Text-based similarity: keyword overlap scoring
    const queryWords = new Set(queryKeywords.toLowerCase().split(/[,\s]+/).filter(Boolean));

    const scored = embeddings.map((e) => {
      const embWords = new Set((e.embedding || "").toLowerCase().split(/[,\s]+/).filter(Boolean));
      let overlap = 0;
      for (const w of queryWords) {
        if (embWords.has(w)) overlap++;
      }
      const score = queryWords.size > 0 ? overlap / queryWords.size : 0;
      return { correction_id: e.correction_id, score };
    }).filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, safeLimit);

    if (scored.length === 0) {
      return new Response(JSON.stringify({ corrections: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch full correction data
    const ids = scored.map((s) => s.correction_id).filter(Boolean);
    const { data: corrections } = await supabase
      .from("corrections")
      .select("id, original_value, corrected_value, fbc_section, context_notes, correction_type")
      .in("id", ids);

    // Merge scores and sort
    const result = (corrections || []).map((c) => ({
      ...c,
      similarity: scored.find((s) => s.correction_id === c.id)?.score || 0,
    })).sort((a, b) => b.similarity - a.similarity);

    return new Response(JSON.stringify({ corrections: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
