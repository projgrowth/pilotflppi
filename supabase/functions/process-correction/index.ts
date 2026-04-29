import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

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
    const { correction_id } = await req.json();
    if (!correction_id) {
      return new Response(JSON.stringify({ error: "correction_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Fetch the correction.
    const { data: correction, error: fetchErr } = await supabase
      .from("corrections")
      .select("*")
      .eq("id", correction_id)
      .single();

    if (fetchErr || !correction) {
      return new Response(JSON.stringify({ error: "Correction not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build the text to embed — rich context for better similarity matching.
    const embeddingText = [
      correction.corrected_value,
      correction.context_notes,
      correction.fbc_section ? `FBC section ${correction.fbc_section}` : "",
      correction.correction_type,
    ]
      .filter(Boolean)
      .join(" | ");

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

    // Prefer OpenAI embeddings (1536-dim, compatible with pgvector index).
    if (openaiKey) {
      const embResp = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: embeddingText,
        }),
      });

      if (!embResp.ok) {
        const err = await embResp.text();
        throw new Error(`OpenAI embeddings failed: ${err.slice(0, 200)}`);
      }

      const embData = await embResp.json();
      const vector: number[] = embData.data?.[0]?.embedding;
      if (!vector) throw new Error("No embedding returned from OpenAI");

      await supabase.from("flag_embeddings").upsert(
        {
          correction_id,
          embedding_vector: JSON.stringify(vector),
          embedding_keywords: embeddingText,
          embedded_at: new Date().toISOString(),
        },
        { onConflict: "correction_id" },
      );

      return new Response(
        JSON.stringify({ success: true, method: "vector", dims: vector.length }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fallback: keyword summary via Lovable AI gateway.
    let keywords = embeddingText;
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
                  "Extract 10-15 normalized keywords from this correction text for similarity matching. Return only comma-separated lowercase keywords. Include: FBC section numbers, discipline, deficiency type, building element.",
              },
              { role: "user", content: embeddingText },
            ],
            max_tokens: 200,
            temperature: 0,
          }),
        },
      );
      if (aiResp.ok) {
        const aiData = await aiResp.json();
        keywords = aiData.choices?.[0]?.message?.content || keywords;
      }
    }

    await supabase.from("flag_embeddings").upsert(
      {
        correction_id,
        embedding_keywords: keywords,
        embedded_at: new Date().toISOString(),
      },
      { onConflict: "correction_id" },
    );

    return new Response(
      JSON.stringify({ success: true, method: "keywords" }),
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
