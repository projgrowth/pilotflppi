import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPTS: Record<string, string> = {

  extract_project_info: `You are analyzing a construction plan title block. Extract the following information from the image:

- project_name: The name of the project
- address: The full street address
- county: The Florida county (return as lowercase with hyphens, e.g., "miami-dade", "palm-beach", "broward")
- jurisdiction: The city or jurisdiction (e.g., "City of Miami", "City of Fort Lauderdale")
- trade_type: The primary trade type. Must be one of: "building", "structural", "mechanical", "electrical", "plumbing", "roofing", "fire"
- architect: The architect or engineer of record name if visible
- permit_number: The permit application number if visible

If a field is not clearly visible, set it to null.

Return ONLY a JSON object with these fields, no additional text.`,

  generate_comment_letter: `You are a professional plan review engineer at Florida Private Providers, Inc. (FPP), a licensed Private Provider firm (License #AR92053) operating under Florida Statute 553.791.

Generate a formal deficiency/comment letter with this structure:

**LETTERHEAD FORMAT:**
Florida Private Providers, Inc.
License #AR92053
Plan Review Comment Letter

**HEADER:**
- Date
- Project Name & Address
- County & Jurisdiction
- Permit Application #: [placeholder]
- Review Round #
- Trade(s) Under Review

**BODY:**
- Opening paragraph referencing F.S. 553.791 and the statutory 30-business-day review period per F.S. 553.791(4)(b)
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

  // generate_inspection_brief, refine_finding_pin, plan_review_check, plan_review_check_visual
  // were removed in Phase 2 audit — no callers in app or pipeline.


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

  extract_zoning_data: `You are analyzing a site plan / survey / zoning sheet image from a Florida construction project. Extract every zoning and lot data point you can find on the sheet.

Look for:
- Zoning district designation (e.g. C-2, R-3, PUD, etc.)
- Lot area / parcel area in square feet
- Building footprint area
- Total building area (gross floor area)
- Number of stories / floors
- Maximum FAR (Floor Area Ratio) if noted
- Maximum lot coverage percentage
- Maximum building height in feet
- Maximum stories allowed
- Setbacks: front, side, rear (in feet)
- Parking ratio (spaces per sqft of building area)
- Landscape buffer width in feet
- Lot frontage in linear feet
- Signage ratio (sqft per linear foot of frontage)
- Occupancy groups (IBC/FBC codes like B, M, S-1, A-2, etc.)
- Any zoning notes or variance information

Extract numerical values as numbers, not strings. If a value is not visible or not present on the sheet, return null for that field. For occupancy_groups return an array of code strings. For notes, include any relevant zoning text you find.`,

  answer_code_question: `You are an expert on the Florida Building Code (FBC) 2023 edition, including all referenced standards (ASCE 7, ACI 318, NEC, etc.). Answer code questions accurately and cite specific sections.

Always:
- Cite the exact FBC section number
- Note if requirements differ in the HVHZ (High Velocity Hurricane Zone)
- Mention relevant Florida Statutes if applicable
- Provide practical guidance for compliance`,

  fbc_county_chat: `You are an expert Florida Building Code (FBC 2023, 8th Edition) consultant specializing in county-specific requirements for Private Providers operating under F.S. 553.791.

You will receive the selected county's requirements as context. Use this to tailor every answer to that county's specific:
- Wind speed design requirements (ASCE 7-22)
- Product approval standards (NOA for HVHZ counties, FL# for non-HVHZ)
- Local code amendments
- HVHZ requirements (Miami-Dade & Broward)
- Coastal Construction Control Line (CCCL) applicability
- Flood zone requirements
- Energy code compliance path
- Building department contact information

Rules:
- Always cite specific FBC 2023 section numbers
- When the county is in the HVHZ, emphasize TAS 201/202/203, NOA requirements, and FBC 1626
- Reference county-specific amendments when relevant
- Note differences from standard FBC requirements
- Reference F.S. 553.791 for Private Provider procedures
- Use markdown formatting: headers, bold for code refs, bullet lists
- Keep answers thorough but focused — a working inspector should be able to act on your guidance immediately`,
};

// Tool schemas for structured output
// Note: PLAN_REVIEW_TOOL removed in Phase 2 audit. The active multi-stage
// pipeline (run-review-pipeline/stages/*) declares its own tool schemas.


const EXTRACT_PROJECT_TOOL = {
  type: "function" as const,
  function: {
    name: "extract_project_info",
    description: "Extract project information from a title block image",
    parameters: {
      type: "object",
      properties: {
        project_name: { type: "string", description: "Project name" },
        address: { type: "string", description: "Full address" },
        county: { type: "string", description: "Florida county in lowercase with hyphens" },
        jurisdiction: { type: "string", description: "City or jurisdiction" },
        trade_type: { type: "string", enum: ["building", "structural", "mechanical", "electrical", "plumbing", "roofing", "fire"] },
        architect: { type: "string", description: "Architect or engineer name" },
        permit_number: { type: "string", description: "Permit number if visible" },
      },
      required: ["project_name", "address", "county", "trade_type"],
      additionalProperties: false,
    },
  },
};

const EXTRACT_ZONING_TOOL = {
  type: "function" as const,
  function: {
    name: "extract_zoning_data",
    description: "Extract zoning and lot data from a site plan image",
    parameters: {
      type: "object",
      properties: {
        zoning_district: { type: "string", description: "Zoning district code" },
        lot_area_sqft: { type: "number", description: "Lot area in square feet" },
        building_footprint_sqft: { type: "number", description: "Building footprint in sqft" },
        total_building_area_sqft: { type: "number", description: "Total building area in sqft" },
        stories: { type: "number", description: "Number of stories" },
        max_far: { type: "number", description: "Maximum FAR" },
        max_lot_coverage_pct: { type: "number", description: "Max lot coverage percentage" },
        max_height_ft: { type: "number", description: "Max building height in feet" },
        max_stories: { type: "number", description: "Max stories allowed" },
        setback_front_ft: { type: "number", description: "Front setback in feet" },
        setback_side_ft: { type: "number", description: "Side setback in feet" },
        setback_rear_ft: { type: "number", description: "Rear setback in feet" },
        parking_ratio_per_sqft: { type: "number", description: "Parking ratio: 1 space per X sqft" },
        landscape_buffer_ft: { type: "number", description: "Landscape buffer in feet" },
        frontage_lf: { type: "number", description: "Lot frontage in linear feet" },
        signage_ratio_sqft_per_lf: { type: "number", description: "Signage ratio sqft per LF" },
        occupancy_groups: { type: "array", items: { type: "string" }, description: "Occupancy group codes" },
        notes: { type: "string", description: "Any zoning notes found" },
      },
      required: ["zoning_district"],
      additionalProperties: false,
    },
  },
};

// Actions that use multimodal (vision) capabilities
const MULTIMODAL_ACTIONS = new Set(["extract_project_info", "extract_zoning_data"]);

// Actions that use tool calling for structured output
// deno-lint-ignore no-explicit-any
const TOOL_CALL_ACTIONS: Record<string, any> = {
  extract_project_info: EXTRACT_PROJECT_TOOL,
  extract_zoning_data: EXTRACT_ZONING_TOOL,
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // --- JWT Authentication ---
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAuth = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getClaims(token);
  if (claimsError || !claimsData?.claims) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let action: string;
  let payload: any;
  try {
    const body = await req.json();
    action = body.action;
    payload = body.payload;
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid or empty request body" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {

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
    const stream = payload?.stream === true;
    const isMultimodal = MULTIMODAL_ACTIONS.has(action);
    const toolDef = TOOL_CALL_ACTIONS[action];
    const useToolCalling = !!toolDef && !stream;

    // Build messages
    let systemContent = systemPrompt;

    // For fbc_county_chat, inject county context into system prompt
    if (action === "fbc_county_chat" && payload?.county_context) {
      systemContent += `\n\n## Current County Context\n${JSON.stringify(payload.county_context, null, 2)}`;
    }

    const messages: Array<Record<string, unknown>> = [
      { role: "system", content: systemContent },
    ];

    // For fbc_county_chat, use conversation history
    if (action === "fbc_county_chat" && payload?.conversation && Array.isArray(payload.conversation)) {
      for (const msg of payload.conversation) {
        messages.push({ role: msg.role, content: msg.content });
      }
    } else if (isMultimodal && payload?.images && Array.isArray(payload.images)) {
      // Multimodal: send images as content parts
      const contentParts: Array<Record<string, unknown>> = [];

      // Add text context if present
      const textPayload = { ...payload };
      delete textPayload.images;
      delete textPayload.stream;
      if (Object.keys(textPayload).length > 0) {
        contentParts.push({ type: "text", text: JSON.stringify(textPayload) });
      }

      // Add image parts
      for (const img of payload.images) {
        const base64Data = img.startsWith("data:") ? img : `data:image/png;base64,${img}`;
        contentParts.push({
          type: "image_url",
          image_url: { url: base64Data },
        });
      }

      messages.push({ role: "user", content: contentParts });
    } else {
      // Text-only
      const userMessage = typeof payload === "string" ? payload : JSON.stringify(payload);
      messages.push({ role: "user", content: userMessage });
    }

    // Select model: use gemini-2.5-pro for multimodal, gemini-3-flash-preview for text
    const model = isMultimodal ? "google/gemini-2.5-pro" : "google/gemini-3-flash-preview";

    const requestBody: Record<string, unknown> = {
      model,
      messages,
      stream,
    };

    if (useToolCalling) {
      requestBody.tools = [toolDef];
      requestBody.tool_choice = { type: "function", function: { name: toolDef.function.name } };
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
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds in Settings > Workspace > Usage." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (stream) {
      return new Response(response.body, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }

    const data = await response.json();

    // Handle tool call response
    if (useToolCalling) {
      const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall?.function?.arguments) {
        try {
          const parsed = JSON.parse(toolCall.function.arguments);
          // For extract_project_info and extract_zoning_data, return the object directly
          if (action === "extract_project_info" || action === "extract_zoning_data") {
            return new Response(JSON.stringify({ content: JSON.stringify(parsed) }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          // For plan review, return findings array
          return new Response(JSON.stringify({ content: JSON.stringify(parsed.findings) }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e) {
          console.error("Failed to parse tool call arguments:", e);
        }
      }
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
