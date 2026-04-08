import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPTS: Record<string, string> = {
  plan_review_check: `You are an expert Florida Building Code (FBC 2023) plan reviewer for a licensed Private Provider firm operating under Florida Statute 553.791.

You will receive project context including the county/jurisdiction. Tailor your analysis to county-specific requirements:

**HVHZ (High Velocity Hurricane Zone)**: Miami-Dade and Broward counties have enhanced requirements:
- Miami-Dade County: Testing/approval per TAS 201, 202, 203 for impact-resistant products
- ASCE 7 wind speeds ≥ 170 mph, missile impact criteria per FBC 1626
- Product approvals must be Miami-Dade NOA (Notice of Acceptance)
- Enhanced roofing requirements per FBC 1523 (HVHZ)

**Non-HVHZ Counties** (Palm Beach, Sarasota, etc.): Standard FBC wind load per ASCE 7, Florida Product Approvals (FL #) accepted.

**County Amendments**: Reference any known county-specific amendments to FBC 2023.

For each finding, provide ALL of the following fields:
- severity: "critical" | "major" | "minor"
- discipline: "structural" | "life_safety" | "fire" | "mechanical" | "electrical" | "plumbing" | "energy" | "ada" | "site"
- code_ref: Specific FBC 2023 section, ASCE 7 section, NFPA reference, or Florida Statute
- county_specific: true if this is driven by a county amendment or HVHZ-specific requirement
- page: Sheet/page reference (use realistic sheet designations like S-101, A-201, E-100, M-100)
- description: Clear, specific description of the deficiency
- recommendation: Actionable fix with code reference
- confidence: "verified" (definite code violation) | "likely" (probable based on common issues) | "advisory" (best practice recommendation)

Produce 8-12 findings spanning multiple disciplines. Ensure at least:
- 2 structural findings
- 1-2 life safety / egress findings
- 1 energy code finding
- 1 ADA finding
- Remaining across fire, MEP as appropriate for the trade type

Return ONLY a JSON array of findings with no additional text.`,

  generate_comment_letter: `You are a professional plan review engineer at Florida Private Providers (FPP), a licensed Private Provider firm (License #PVP-XXXXX) operating under Florida Statute 553.791.

Generate a formal deficiency/comment letter with this structure:

**LETTERHEAD FORMAT:**
Florida Private Providers, Inc.
[License # PVP-XXXXX]
Plan Review Comment Letter

**HEADER:**
- Date
- Project Name & Address
- County & Jurisdiction
- Permit Application #: [placeholder]
- Review Round #
- Trade(s) Under Review

**BODY:**
- Opening paragraph referencing F.S. 553.791 and the statutory 21-day review period
- Group deficiencies BY DISCIPLINE with numbered items
- Each deficiency must include:
  - The FBC 2023 code section or referenced standard
  - For county-specific items, note "Per [County] Amendment" or "HVHZ Requirement"
  - Clear description and required corrective action
- Mark critical items with ⚠️

**CLOSING:**
- Resubmission deadline: 14 calendar days
- Reference statutory authority
- Contact information placeholder
- Reviewer signature block

Use professional, authoritative language. Be specific and actionable.`,

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

// Tool schema for structured plan review output
const PLAN_REVIEW_TOOL = {
  type: "function" as const,
  function: {
    name: "submit_findings",
    description: "Submit plan review findings as structured data",
    parameters: {
      type: "object",
      properties: {
        findings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              severity: { type: "string", enum: ["critical", "major", "minor"] },
              discipline: { type: "string", enum: ["structural", "life_safety", "fire", "mechanical", "electrical", "plumbing", "energy", "ada", "site"] },
              code_ref: { type: "string" },
              county_specific: { type: "boolean" },
              page: { type: "string" },
              description: { type: "string" },
              recommendation: { type: "string" },
              confidence: { type: "string", enum: ["verified", "likely", "advisory"] },
            },
            required: ["severity", "discipline", "code_ref", "county_specific", "page", "description", "recommendation", "confidence"],
            additionalProperties: false,
          },
        },
      },
      required: ["findings"],
      additionalProperties: false,
    },
  },
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

    // Use tool calling for plan_review_check for structured output
    const useToolCalling = action === "plan_review_check";

    const requestBody: Record<string, unknown> = {
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      stream,
    };

    if (useToolCalling && !stream) {
      requestBody.tools = [PLAN_REVIEW_TOOL];
      requestBody.tool_choice = { type: "function", function: { name: "submit_findings" } };
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
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

    // Handle tool call response for structured output
    if (useToolCalling) {
      const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall?.function?.arguments) {
        try {
          const parsed = JSON.parse(toolCall.function.arguments);
          return new Response(JSON.stringify({ content: JSON.stringify(parsed.findings) }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e) {
          console.error("Failed to parse tool call arguments:", e);
        }
      }
      // Fallback to regular content
      const content = data.choices?.[0]?.message?.content || "[]";
      return new Response(JSON.stringify({ content }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
