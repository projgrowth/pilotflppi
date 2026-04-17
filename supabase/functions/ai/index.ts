import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

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

**COMMERCIAL / LARGE-SCALE PROJECTS:**
When the project is commercial (occupancy groups B, M, S-1, F-1, H, A, etc.) or exceeds 10,000 sqft:
- Identify all applicable occupancy groups per FBC Chapter 3
- Check mixed-occupancy fire separation requirements per FBC Table 508.4
- Verify means of egress: travel distance (FBC 1017), exit capacity (FBC 1005), number of exits (FBC 1006)
- Fire sprinkler thresholds per FBC 903.2 based on occupancy and area
- Fire alarm requirements per FBC 907 based on occupancy
- Parking & ADA: accessible spaces per lot size (FBC 1106, ADA Standards 208)
- For auto repair (S-1 with repair bays): ventilation per IMC 502.16, flammable liquid storage per FPC Chapter 57
- For high-piled storage: FPC Chapter 32 requirements
- Energy code: commercial path per FBC Energy Conservation (IECC Commercial)

**MISSING INFORMATION CHECK (Critical for Private Providers):**
Beyond code violations, you MUST flag any of the following that are MISSING from the plans. Building officials will reject a submittal outright for missing required information — this is the #1 reason for plan review rejection.
- No site plan sheet at all
- Site plan missing property boundaries, setbacks, or parking layout
- No code summary table (occupancy, construction type, allowable area)
- No life safety / egress plan
- No structural design criteria (wind speed, exposure, soil bearing)
- No energy compliance documentation (COMcheck or Form 402)
- Missing sealed drawings or engineer of record
- No product approval references on specifications (NOA for HVHZ, FL# for others)
- No flood zone or wind speed designation
- No index of drawings
- Missing fire department access or hydrant locations on site plan
- No stormwater/drainage plan or reference

For missing information findings, use severity "critical" for items that would cause immediate rejection by a building official, and "major" for items that need supplementation. Set the discipline to the most relevant one (e.g., "site" for site plan issues, "structural" for missing structural notes).

Also detect the FBC edition referenced on the plans. If the plans cite an edition other than FBC 2023 (8th Edition), include an advisory finding noting the edition mismatch.

Return ONLY a JSON array of findings with no additional text.`,

  plan_review_check_visual: `You are an expert Florida Building Code (FBC 2023) plan reviewer for a licensed Private Provider firm operating under Florida Statute 553.791.

You are receiving ACTUAL IMAGES of construction plan sheets. Each image is one page from one PDF file. The user message contains an "image_manifest" array describing each image: \`[{ index: 0, file: "Architectural.pdf", page_in_file: 1 }, ...]\`. The image_manifest index is the **same** as the position of that image in the multimodal content array. You MUST use this index for the markup.page_index field.

## EVERY IMAGE HAS A 10×10 GRID OVERLAY

Each image you receive has a faint red 10×10 grid drawn on top of it. Each grid cell is labelled in its top-left corner with a row letter (A-J, top to bottom) and a column digit (0-9, left to right):

- Cell **A0** = the top-left 10% × 10% region (x=0-10%, y=0-10%)
- Cell **H7** = x=70-80%, y=70-80% (lower-right area)
- Cell **J9** = the bottom-right 10% × 10% region

You MUST use these labels to anchor every finding. The grid is your coordinate system — read the visible cell label, do not estimate percentages by eye.

## CRITICAL GROUNDING PROTOCOL — Follow for EVERY finding

For each finding, you MUST internally reason through these steps **before** writing the finding:

1. **Identify the image** you are looking at by its index in the image_manifest. Call this \`image_index\` (0-based).
2. **Read the title block** of that image. The sheet designation (e.g., "S-101", "A-201", "E-100") is almost always in the lower-right corner of an architectural/engineering sheet. Capture this exact string. Call it \`sheet_designation\`.
3. **Locate the specific element** the deficiency relates to. This MUST be a concrete visual landmark you can see — a callout bubble, a dimension line, a note block, a detail bubble, a schedule row, a column on a grid, a wall segment, etc. Do NOT pick a vague area of whitespace.
4. **Read the grid cell label printed in the cell that contains the element's CENTER** (e.g. "H7"). This is the \`grid_cell\` you return.
5. **Capture nearest readable text**: a short string (≤ 40 chars) you can literally read on the sheet within ~5% of the element — a callout number ("12"), a sheet note ref ("NOTE 4"), a dimension ("4'-0\""), a grid line ("B-2"), a schedule row label ("D-1"), a tag ("TYP"), a section letter, etc. This is the \`nearest_text\` you return. If nothing is readable in the immediate vicinity, return an empty string.
6. **Set x, y, width, height** as a refinement WITHIN the grid cell:
   - **PIN** (point issue: missing seal, missing dimension, single wrong note, single non-compliant detail): \`width\` and \`height\` ≤ **4** each. The (x, y) should place the pin's center on the exact element, but the pin must visually sit inside the grid cell named in \`grid_cell\`.
   - **REGION** (spans an area: missing schedule, non-compliant egress path, problematic plan area): \`width\` ≤ **15**, \`height\` ≤ **10**. The region's geometric center should sit within the grid cell named in \`grid_cell\`.
7. **Write the description with a visual anchor**. Every description must include a phrase like "in cell H7, near the door schedule row 4", "at the NW corner of the foundation plan (cell A0)", "near grid B-2 on the upper level plan" so a human reviewer can find the element even if the pin is slightly off.

## Required output fields per finding

- severity: "critical" | "major" | "minor"
- discipline: "structural" | "life_safety" | "fire" | "mechanical" | "electrical" | "plumbing" | "energy" | "ada" | "site"
- code_ref: Specific FBC 2023 section
- county_specific: true if HVHZ-specific
- page: The sheet designation EXACTLY as visible in the title block (e.g., "S-101"). This MUST come from step 2 above. If you cannot read a sheet designation, write "Unknown".
- description: Clear, specific description WITH a visual anchor phrase (per step 7).
- recommendation: Actionable fix with code reference.
- confidence: "verified" | "likely" | "advisory"
- markup: **REQUIRED** object \`{ page_index, grid_cell, nearest_text, x, y, width, height }\` where:
  - **page_index**: the integer image_index from step 1. **NOT a sheet number** — do not write 101 here when the image is at index 3.
  - **grid_cell**: REQUIRED. The cell label (e.g. "H7") that contains the element's center. Must match one of A0..J9. The viewer trusts this label more than (x, y) — if the two disagree, the pin is forced inside the named cell.
  - **nearest_text**: REQUIRED. A short string (≤ 40 chars) visible on the sheet near the pin, or empty string "" if nothing readable is near.
  - **x, y**: top-left of the box as percentages of the image (0-100). Should refine the position WITHIN the grid_cell.
  - **width, height**: percentages. Pin = ≤4×4. Region = ≤15×10. NEVER exceed 15% width or 10% height.
  - The page_index MUST be in range 0..N-1 where N is the number of images sent. If unsure which image, pick the one whose visible sheet designation matches your \`page\` field.

## Tailor analysis to county

**HVHZ (High Velocity Hurricane Zone)**: Miami-Dade and Broward counties:
- Miami-Dade: TAS 201/202/203 for impact-resistant products
- ASCE 7 wind speeds ≥ 170 mph, missile impact per FBC 1626
- Product approvals must be Miami-Dade NOA
- Enhanced roofing per FBC 1523 (HVHZ)

**Non-HVHZ Counties**: Standard FBC wind load per ASCE 7, Florida Product Approvals (FL #).

## Missing information check

If REQUIRED elements are missing, flag them. Place the markup where the information SHOULD appear (title block area for missing code summary, etc.). Use grid_cell "I8" or "J8" for title-block area, "I9"/"J9" for the lower-right corner:
- Site plan: property boundaries, setbacks, parking with ADA, drainage, utility connections, fire access/hydrants, easements
- General: title block with seal, drawing index, code summary table, life safety plan, structural notes (wind speed, exposure), energy compliance, product approval numbers, FBC edition
- County-specific: flood zone/BFE, CCCL, NOA numbers, threshold building

For missing items, use "critical" severity if it would cause immediate rejection.

Report only real violations. Do not pad the count. If the FBC edition referenced is not FBC 2023 (8th Edition), include an advisory finding.`,

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
                description: "Bounding box on the plan image. page_index is the 0-based position of the image in the multimodal content array (matches image_manifest.index). NOT a sheet number. grid_cell anchors the pin to one of 100 visible labelled cells (A0..J9) so the worst-case error is bounded.",
                properties: {
                  page_index: { type: "number", description: "0-based image array index from image_manifest. Must be in range 0..N-1." },
                  grid_cell: { type: "string", description: "REQUIRED. Visible grid cell label containing the element's center, e.g. 'H7'. Row A-J (top→bottom) + column 0-9 (left→right). Must literally match one of the labels printed on the image." },
                  nearest_text: { type: "string", description: "REQUIRED. Short string (≤40 chars) visible on the sheet within ~5% of the pin (callout number, dimension, note ref, schedule row label, grid line, 'TYP', etc.). Empty string '' if nothing readable is near." },
                  x: { type: "number", description: "Left edge as percentage of image width (0-100). Refines location WITHIN the grid_cell." },
                  y: { type: "number", description: "Top edge as percentage of image height (0-100). Refines location WITHIN the grid_cell." },
                  width: { type: "number", description: "Box width as percentage. Pin (point issue) ≤ 4. Region ≤ 15. Never exceed 15." },
                  height: { type: "number", description: "Box height as percentage. Pin ≤ 4. Region ≤ 10. Never exceed 10." },
                },
                required: ["page_index", "grid_cell", "nearest_text", "x", "y", "width", "height"],
              },
            },
            required: ["severity", "discipline", "code_ref", "county_specific", "page", "description", "recommendation", "confidence", "markup"],
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
const MULTIMODAL_ACTIONS = new Set(["plan_review_check_visual", "extract_project_info", "extract_zoning_data"]);

// Actions that use tool calling for structured output
const TOOL_CALL_ACTIONS: Record<string, typeof PLAN_REVIEW_TOOL> = {
  plan_review_check: PLAN_REVIEW_TOOL,
  plan_review_check_visual: PLAN_REVIEW_TOOL,
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
