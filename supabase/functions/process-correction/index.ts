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

    // Fetch the correction
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

    // Generate a text fingerprint/summary for similarity matching using Lovable AI
    const embeddingText = [
      correction.corrected_value,
      correction.context_notes,
      correction.fbc_section ? `FBC ${correction.fbc_section}` : "",
      correction.correction_type,
    ].filter(Boolean).join(" | ");

    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) {
      // Store raw text as embedding fallback
      await supabase.from("flag_embeddings").insert({
        correction_id,
        embedding: embeddingText,
      });
      return new Response(JSON.stringify({ success: true, method: "text_fallback" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use Lovable AI to generate a normalized keyword summary for matching
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
            content: "Extract 10-15 normalized keywords from this correction text for similarity matching. Return only comma-separated lowercase keywords. Include: FBC section numbers, discipline, deficiency type, building element.",
          },
          { role: "user", content: embeddingText },
        ],
        max_tokens: 200,
        temperature: 0,
      }),
    });

    let keywords = embeddingText;
    if (aiResp.ok) {
      const aiData = await aiResp.json();
      keywords = aiData.choices?.[0]?.message?.content || embeddingText;
    }

    // Store in flag_embeddings
    await supabase.from("flag_embeddings").insert({
      correction_id,
      embedding: keywords,
    });

    return new Response(JSON.stringify({ success: true, keywords }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
