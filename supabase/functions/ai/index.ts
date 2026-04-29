import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

// CORS allowlist (audit A-02). Only origins we operate from may call this
// function from a browser. Edge-to-edge / server requests bypass CORS by
// not sending an Origin header, so this only restricts cross-site browsers.
const ALLOWED_ORIGINS = new Set<string>([
  "https://projgrowth.site",
  "https://www.projgrowth.site",
  "https://pilotflppi.lovable.app",
]);
const ALLOWED_ORIGIN_PATTERNS: RegExp[] = [
  // Lovable preview/sandbox URLs (id-preview--<uuid>.lovable.app, *.sandbox.lovable.dev, lovableproject.com)
  /^https:\/\/[a-z0-9-]+\.lovable\.app$/i,
  /^https:\/\/[a-z0-9-]+\.sandbox\.lovable\.dev$/i,
  /^https:\/\/[a-z0-9-]+\.lovableproject\.com$/i,
  // Local dev
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

/**
 * Build per-action system prompts. Firm identity, FBC edition, and
 * resubmission deadline are NEVER hardcoded — every value flows in via
 * payload so a second firm or a project under FBC 7th Edition produces
 * a correct letter. Defaults are explicit and labeled as fallbacks.
 *
 * Audit reference: C-02 (firm hardcoded), C-06 (FBC edition hardcoded),
 * H-05 (14-day deadline hardcoded). All three resolved here.
 */
interface PromptContext {
  firm_name?: string | null;
  license_number?: string | null;
  fbc_edition?: string | null;
  resubmission_days?: number | null;
}

function payloadObject(payload: unknown): Record<string, Json> {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, Json>
    : {};
}

function buildSystemPrompt(action: string, ctx: PromptContext): string {
  const firmName = (ctx.firm_name && ctx.firm_name.trim()) || "[Firm name not configured]";
  const licenseNumber = (ctx.license_number && ctx.license_number.trim()) || "[License # not configured]";
  const fbcEdition = (ctx.fbc_edition && ctx.fbc_edition.trim()) || "FBC 2023 (default — project FBC edition not extracted)";
  const resubDays = typeof ctx.resubmission_days === "number" && ctx.resubmission_days > 0
    ? ctx.resubmission_days
    : 14;
  const resubLabel = typeof ctx.resubmission_days === "number" && ctx.resubmission_days > 0
    ? `${resubDays} calendar days`
    : `${resubDays} calendar days (default — county-specific deadline not configured)`;
  const builders: Record<string, () => string> = {
    extract_project_info: () => `You are analyzing a construction plan title block. Extract the following information from the image:

- project_name: The name of the project
- address: The full street address
- county: The Florida county (return as lowercase with hyphens, e.g., "miami-dade", "palm-beach", "broward")
- jurisdiction: The city or jurisdiction (e.g., "City of Miami", "City of Fort Lauderdale")
- trade_type: The primary trade type. Must be one of: "building", "structural", "mechanical", "electrical", "plumbing", "roofing", "fire"
- architect: The architect or engineer of record name if visible
- permit_number: The permit application number if visible

If a field is not clearly visible, set it to null.

Return ONLY a JSON object with these fields, no additional text.`,

    generate_comment_letter: () => `You are a professional plan review engineer at ${firmName}, a licensed Private Provider firm (License #${licenseNumber}) operating under Florida Statute 553.791.

Generate a formal deficiency/comment letter with this structure:

**LETTERHEAD FORMAT:**
${firmName}
License #${licenseNumber}
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
  - The applicable code section per ${fbcEdition} (or referenced standard such as ASCE 7, NEC, ACI 318)
  - For county-specific items, note "Per [County] Amendment" or "HVHZ Requirement"
  - Clear description and required corrective action
- Mark critical items with ⚠️

**CLOSING:**
- Resubmission deadline: ${resubLabel}
- Reference statutory authority
- Contact information placeholder
- Reviewer signature block

Use professional, authoritative language. Be specific and actionable. Cite the code edition exactly as given (${fbcEdition}) — do not substitute a different edition.`,

    generate_outreach_email: () => `You are a business development specialist at ${firmName}, a licensed private building inspection and plan review firm. Write a personalized outreach email to a contractor who recently pulled a building permit.

The email should:
- Be warm, professional, and concise (under 200 words)
- Reference their specific project and permit type
- Highlight the firm's value: faster turnaround than municipal review, 21-day guaranteed timeline
- Mention virtual inspections and AI-powered plan review
- Include a clear call-to-action (schedule a call or reply)
- Sign off as the ${firmName} team`,

    generate_milestone_outreach: () => `You are a compliance specialist at ${firmName}. Write a professional outreach email to a building owner/manager regarding their upcoming milestone inspection requirement under Florida Statute 553.899.

The email should:
- Reference the specific building name and address
- Explain the milestone inspection requirement clearly
- Note the deadline urgency if applicable
- Offer the firm's milestone inspection services
- Be professional but convey urgency for overdue buildings
- Include next steps (schedule an assessment)`,

    extract_zoning_data: () => `You are analyzing a site plan / survey / zoning sheet image from a Florida construction project. Extract every zoning and lot data point you can find on the sheet.

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

    answer_code_question: () => `You are an expert on the Florida Building Code (${fbcEdition}), including all referenced standards (ASCE 7, ACI 318, NEC, etc.). Answer code questions accurately and cite specific sections.

Always:
- Cite the exact code section number per ${fbcEdition}
- Note if requirements differ in the HVHZ (High Velocity Hurricane Zone)
- Mention relevant Florida Statutes if applicable
- Provide practical guidance for compliance`,

    fbc_county_chat: () => `You are an expert Florida Building Code consultant (working under ${fbcEdition}) specializing in county-specific requirements for Private Providers operating under F.S. 553.791.

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
- Always cite specific code sections per ${fbcEdition}
- When the county is in the HVHZ, emphasize TAS 201/202/203, NOA requirements, and FBC 1626
- Reference county-specific amendments when relevant
- Note differences from standard FBC requirements
- Reference F.S. 553.791 for Private Provider procedures
- Use markdown formatting: headers, bold for code refs, bullet lists
- Keep answers thorough but focused — a working inspector should be able to act on your guidance immediately`,
  };
  const builder = builders[action];
  return builder ? builder() : "";
}

const VALID_ACTIONS = new Set([
  "extract_project_info",
  "generate_comment_letter",
  "generate_outreach_email",
  "generate_milestone_outreach",
  "extract_zoning_data",
  "answer_code_question",
  "fbc_county_chat",
]);

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
  const corsHeaders = corsFor(req);

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

    if (!action || !VALID_ACTIONS.has(action)) {
      return new Response(
        JSON.stringify({ error: `Invalid action. Valid actions: ${Array.from(VALID_ACTIONS).join(", ")}` }),
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

    const payloadObj = payloadObject(payload);
    const userId = claimsData.claims.sub;
    let promptFirmName = typeof payloadObj.firm_name === "string" ? payloadObj.firm_name : null;
    let promptLicenseNumber = typeof payloadObj.license_number === "string" ? payloadObj.license_number : null;

    if (!promptFirmName || !promptLicenseNumber) {
      const admin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      const { data: membership } = await admin
        .from("firm_members")
        .select("firm_id")
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      const firmId = (membership as { firm_id?: string | null } | null)?.firm_id ?? null;
      if (firmId) {
        const { data: firmSettings } = await admin
          .from("firm_settings")
          .select("firm_name, license_number")
          .eq("firm_id", firmId)
          .maybeSingle();

        promptFirmName = promptFirmName || (firmSettings as { firm_name?: string | null } | null)?.firm_name || null;
        promptLicenseNumber = promptLicenseNumber || (firmSettings as { license_number?: string | null } | null)?.license_number || null;
      }
    }

    // Build the per-request system prompt with firm/code/deadline injected
    // dynamically. See PromptContext for the contract — callers pass these
    // via payload.{firm_name, license_number, fbc_edition, resubmission_days}.
    const systemPrompt = buildSystemPrompt(action, {
      firm_name: promptFirmName,
      license_number: promptLicenseNumber,
      fbc_edition: payload?.fbc_edition ?? null,
      resubmission_days: typeof payload?.resubmission_days === "number" ? payload.resubmission_days : null,
    });
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
      delete textPayload.firm_name;
      delete textPayload.license_number;
      delete textPayload.fbc_edition;
      delete textPayload.resubmission_days;
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
      // Text-only — strip prompt-context fields before sending the user payload
      // so they don't bloat the user message (they're already in the system prompt).
      const userPayload = (() => {
        if (typeof payload === "string") return payload;
        if (!payload || typeof payload !== "object") return JSON.stringify(payload);
        const clone = { ...payload };
        delete clone.firm_name;
        delete clone.license_number;
        delete clone.fbc_edition;
        delete clone.resubmission_days;
        delete clone.stream;
        return JSON.stringify(clone);
      })();
      messages.push({ role: "user", content: userPayload });
    }

    // Model selection.
    // - Title-block / zoning extraction → gemini-2.5-flash (multimodal, fast).
    //   The title block is a small, structured region; pro-tier latency (~18s)
    //   was tripping the 20s client timeout in NewReviewDialog with no fidelity
    //   benefit for this task.
    // - Other multimodal (full sheet vision) → gemini-2.5-pro for fidelity.
    // - Text-only → gemini-2.5-flash for speed/cost.
    const FAST_MULTIMODAL_ACTIONS = new Set(["extract_project_info", "extract_zoning_data"]);
    const model = isMultimodal
      ? (FAST_MULTIMODAL_ACTIONS.has(action) ? "google/gemini-2.5-flash" : "google/gemini-2.5-pro")
      : "google/gemini-2.5-flash";

    // Temperature policy (audit C-04). Determinism matters for legal output:
    // letters and code answers run at 0; outreach/marketing copy runs warmer
    // for variety. Multimodal extraction is deterministic (parse, not write).
    const TEMPERATURE_BY_ACTION: Record<string, number> = {
      generate_comment_letter: 0,
      answer_code_question: 0,
      fbc_county_chat: 0,
      extract_project_info: 0,
      extract_zoning_data: 0,
      generate_outreach_email: 0.7,
      generate_milestone_outreach: 0.7,
    };
    const temperature = TEMPERATURE_BY_ACTION[action] ?? 0;

    const requestBody: Record<string, unknown> = {
      model,
      messages,
      stream,
      temperature,
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
