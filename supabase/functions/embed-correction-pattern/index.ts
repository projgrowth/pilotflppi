// Embeds a correction_patterns row so the discipline-review prompt can
// recall semantically related rejections via match_correction_patterns.
// Called fire-and-forget by the client right after a reject is recorded.
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
    const { pattern_id } = await req.json();
    if (!pattern_id || typeof pattern_id !== "string") {
      return new Response(JSON.stringify({ error: "pattern_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: row, error } = await supabase
      .from("correction_patterns")
      .select(
        "id, pattern_summary, original_finding, original_required_action, reason_notes, code_reference, discipline",
      )
      .eq("id", pattern_id)
      .single();
    if (error || !row) {
      return new Response(JSON.stringify({ error: "pattern not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const section =
      (row.code_reference as { section?: string } | null)?.section ?? null;
    const text = [
      row.pattern_summary,
      row.original_finding,
      row.original_required_action,
      row.reason_notes,
      section ? `FBC ${section}` : null,
      `Discipline: ${row.discipline}`,
    ]
      .filter(Boolean)
      .join(" | ")
      .slice(0, 7800);

    const embResp = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
    });
    if (!embResp.ok) {
      const e = await embResp.text();
      throw new Error(`embeddings failed: ${e.slice(0, 200)}`);
    }
    const embData = await embResp.json();
    const vector: number[] = embData?.data?.[0]?.embedding;
    if (!Array.isArray(vector)) {
      throw new Error("no embedding returned");
    }

    const { error: updErr } = await supabase
      .from("correction_patterns")
      .update({
        embedding_vector: JSON.stringify(vector),
        embedded_at: new Date().toISOString(),
      })
      .eq("id", pattern_id);
    if (updErr) throw updErr;

    return new Response(
      JSON.stringify({ success: true, dims: vector.length }),
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
