import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPTS: Record<string, string> = {
  plan_review_check: `You are an expert Florida Building Code (FBC 2023) plan reviewer for a licensed Private Provider firm operating under Florida Statute 553.791.

You will receive project context including the county/jurisdiction, and possibly document context describing the actual plan sheets. If document context is provided, analyze THOSE SPECIFIC PLANS for code compliance — do not fabricate generic findings.

Tailor your analysis to county-specific requirements:

**HVHZ (High Velocity Hurricane Zone)**: Miami-Dade and Broward counties have enhanced requirements:
- Miami-Dade County: Testing/approval per TAS 201, 202, 203 for impact-resistant products
- ASCE 7 wind speeds ≥ 170 mph, missile impact criteria per FBC 1626
- Product approvals must be Miami-Dade NOA (Notice of Acceptance)
- Enhanced roofing requirements per FBC 1523 (HVHZ)

**Non-HVHZ Counties** (Palm Beach, Sarasota, etc.): Standard FBC wind load per ASCE 7, Florida Product Approvals (FL #) accepted.

**County Amendments**: Reference any known county-specific amendments to FBC 2023.

**Code Edition Detection**: If the plans reference a different code edition (e.g., FBC 2020-R 7th Edition), flag this as an advisory finding noting the edition mismatch and which edition your analysis is based on.

For each finding, provide ALL of the following fields:
- severity: "critical" | "major" | "minor"
- discipline: "structural" | "life_safety" | "fire" | "mechanical" | "electrical" | "plumbing" | "energy" | "ada" | "site"
- code_ref: Specific FBC 2023 section, ASCE 7 section, NFPA reference, or Florida Statute
- county_specific: true if this is driven by a county amendment or HVHZ-specific requirement
- page: Sheet/page reference (use realistic sheet designations like S-101, A-201, E-100, M-100, or match sheet numbers from the actual documents if provided)
- description: Clear, specific description of the deficiency
- recommendation: Actionable fix with code reference
- confidence: "verified" (definite code violation) | "likely" (probable based on common issues) | "advisory" (best practice recommendation)
- county_amendment_ref: If county_specific is true, provide the specific local amendment reference (e.g., "Miami-Dade Sec. 8A-100.2", "Broward County Amendment to FBC Ch. 17.2.4")

County-specific context will be provided in the payload. Use it to:
- Reference the correct local code amendments in county_specific findings
- Apply the correct product approval standard (NOA for HVHZ counties, FL# for others)
- Flag county-specific wind speed and impact protection requirements

Report ALL code violations and deficiencies found. Do not pad with advisory items to meet a count — if fewer than 3 real issues exist, report only those and note that the plans are substantially compliant. Cover all relevant disciplines (structural, life safety, fire, MEP, energy, ADA) but only report genuine code violations or deficiencies.

Also detect the FBC edition referenced on the plans. If the plans cite an edition other than FBC 2023 (8th Edition), include an advisory finding noting the edition mismatch.

Return ONLY a JSON array of findings with no additional text.`,

  plan_review_check_visual: `You are an expert Florida Building Code (FBC 2023) plan reviewer for a licensed Private Provider firm operating under Florida Statute 553.791.

You are receiving ACTUAL IMAGES of construction plan sheets. Analyze each sheet carefully for code compliance violations.

Tailor your analysis to county-specific requirements:

**HVHZ (High Velocity Hurricane Zone)**: Miami-Dade and Broward counties have enhanced requirements:
- Miami-Dade County: Testing/approval per TAS 201, 202, 203 for impact-resistant products
- ASCE 7 wind speeds ≥ 170 mph, missile impact criteria per FBC 1626
- Product approvals must be Miami-Dade NOA (Notice of Acceptance)
- Enhanced roofing requirements per FBC 1523 (HVHZ)

**Non-HVHZ Counties**: Standard FBC wind load per ASCE 7, Florida Product Approvals (FL #) accepted.

For each finding, provide ALL of the following fields:
- severity: "critical" | "major" | "minor"
- discipline: "structural" | "life_safety" | "fire" | "mechanical" | "electrical" | "plumbing" | "energy" | "ada" | "site"
- code_ref: Specific FBC 2023 section
- county_specific: true if HVHZ-specific
- page: The sheet designation visible on the drawing (e.g., S-101, A-201)
- description: Clear, specific description of the deficiency you SEE in the plans
- recommendation: Actionable fix with code reference
- confidence: "verified" | "likely" | "advisory"
- markup: Object with { page_index: <0-based index of the image where the issue is>, x: <percentage from left 0-100>, y: <percentage from top 0-100>, width: <percentage width 5-30>, height: <percentage height 3-20> } indicating WHERE on the plan the issue is located. Be as precise as possible.

Report ALL code violations and deficiencies you actually see in the plans. Do not fabricate findings to meet a target count — if few real issues exist, report only those and note substantial compliance. Focus on REAL issues visible in the drawings.

Also detect the FBC edition referenced on the plans. If visible and not FBC 2023 (8th Edition), include an advisory finding noting the edition mismatch.

Return ONLY a JSON array of findings with no additional text.`,

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
              county_amendment_ref: { type: "string", description: "Specific county amendment reference if county_specific is true (e.g., 'Miami-Dade Sec. 8A', 'Broward County Amendment to FBC Ch. 17')" },
              markup: {
                type: "object",
                properties: {
                  page_index: { type: "number" },
                  x: { type: "number" },
                  y: { type: "number" },
                  width: { type: "number" },
                  height: { type: "number" },
                },
                required: ["page_index", "x", "y", "width", "height"],
              },
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

// Actions that use multimodal (vision) capabilities
const MULTIMODAL_ACTIONS = new Set(["plan_review_check_visual", "extract_project_info"]);

// Actions that use tool calling for structured output
const TOOL_CALL_ACTIONS: Record<string, typeof PLAN_REVIEW_TOOL> = {
  plan_review_check: PLAN_REVIEW_TOOL,
  plan_review_check_visual: PLAN_REVIEW_TOOL,
  extract_project_info: EXTRACT_PROJECT_TOOL,
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
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
          // For extract_project_info, return the object directly
          if (action === "extract_project_info") {
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
