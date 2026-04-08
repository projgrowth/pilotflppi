import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPTS: Record<string, string> = {
  plan_review_check: `You are an expert Florida Building Code (FBC) plan reviewer for a licensed Private Provider firm. Analyze the provided plan details and identify potential code violations, deficiencies, and areas requiring attention.

For each finding, provide:
- A severity level (critical, major, minor)
- The specific FBC code reference (e.g., FBC 2023 Section 1003.5)
- The page/sheet reference if applicable
- A clear description of the issue
- A specific recommendation for resolution

Focus on: structural integrity, fire safety, egress, ADA compliance, energy code (FBC Energy Conservation), mechanical/electrical/plumbing per trade, and wind load requirements per ASCE 7 for Florida's High Velocity Hurricane Zone (HVHZ) where applicable.

Return your analysis as a JSON array of findings using this exact structure:
[{"severity":"critical|major|minor","code_ref":"FBC section","page":"sheet/page ref","description":"issue description","recommendation":"how to fix"}]`,

  generate_comment_letter: `You are a professional plan review engineer at a Florida Private Provider firm. Generate a formal comment letter for deficiencies found during plan review.

The letter should:
- Be addressed to the contractor/design professional
- Reference the project name, address, and permit application
- List each deficiency with the specific Florida Building Code citation
- Use professional, clear language
- Include a deadline for resubmission (14 calendar days)
- Reference the 21-day statutory review period under Florida Statute 553.791

Format as a professional letter with proper salutation and closing.`,

  generate_inspection_brief: `You are a field inspection coordinator for a Florida Private Provider. Generate a concise pre-inspection briefing (max 200 words) for the inspector.

Include:
- Project overview and trade type
- Key items to verify based on the project stage
- Any previous deficiencies to re-check
- Florida-specific requirements (wind mitigation, flood zone, HVHZ if applicable)
- Safety reminders

Keep it actionable and focused.`,

  generate_outreach_email: `You are a business development specialist at Florida Private Providers (FPP), a licensed private building inspection and plan review firm. Write a personalized outreach email to a contractor who recently pulled a building permit.

The email should:
- Be warm, professional, and concise (under 200 words)
- Reference their specific project and permit type
- Highlight FPP's value: faster turnaround than municipal review, 21-day guaranteed timeline
- Mention virtual inspections and AI-powered plan review
- Include a clear call-to-action (schedule a call or reply)
- Sign off as the FPP team`,

  generate_milestone_outreach: `You are a compliance specialist at Florida Private Providers (FPP). Write a professional outreach email to a building owner/manager regarding their upcoming milestone inspection requirement under Florida Statute 553.899.

The email should:
- Reference the specific building name and address
- Explain the milestone inspection requirement clearly
- Note the deadline urgency if applicable
- Offer FPP's milestone inspection services
- Be professional but convey urgency for overdue buildings
- Include next steps (schedule an assessment)`,

  answer_code_question: `You are an expert on the Florida Building Code (FBC) 2023 edition, including all referenced standards (ASCE 7, ACI 318, NEC, etc.). Answer code questions accurately and cite specific sections.

Always:
- Cite the exact FBC section number
- Note if requirements differ in the HVHZ (High Velocity Hurricane Zone)
- Mention relevant Florida Statutes if applicable
- Provide practical guidance for compliance`,
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, payload } = await req.json();

    if (!action || !SYSTEM_PROMPTS[action]) {
      return new Response(
        JSON.stringify({ error: `Invalid action. Valid actions: ${Object.keys(SYSTEM_PROMPTS).join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "AI service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = SYSTEM_PROMPTS[action];
    const userMessage = typeof payload === "string" ? payload : JSON.stringify(payload);

    const stream = payload?.stream === true;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        stream,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds in Settings > Workspace > Usage." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (stream) {
      return new Response(response.body, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    return new Response(JSON.stringify({ content }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("AI function error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
