
## Plan: County-Specific Document Generation

### Problem
The comment letter and generated documents are generic — they use the same template, boilerplate, and requirements regardless of which Florida county the project is in. Each county building department has different submission requirements, forms, amendment references, and supplemental documents.

### What changes

**1. Create a county requirements registry (`src/lib/county-requirements.ts`)**

A structured config file mapping each major Florida county to its specific requirements:
- **Submission format preferences** (e.g., Miami-Dade requires NOA numbers on every product, Broward wants specific form references)
- **County-specific code amendments** to cite in the letter (e.g., Miami-Dade Sec. 8A, Broward County amendments to FBC Ch. 17)
- **Required supplemental sections** per county: wind mitigation forms, product approval tables (FL# vs NOA), flood zone statements, energy compliance paths, threshold building disclosures
- **Letterhead/addressee info**: Building Official name/title, department name, mailing address for each county/jurisdiction
- **Resubmission timelines** (some counties differ from the standard 14-day)
- **Special flags**: HVHZ (already exists), coastal construction control line (CCCL), flood zone requirements, threshold building thresholds

Cover the major counties: Miami-Dade, Broward, Palm Beach, Hillsborough, Orange, Duval, Pinellas, Lee, Sarasota, Volusia, plus a "default" fallback.

**2. Enhance the Comment Letter HTML builder (`src/components/CommentLetterExport.tsx`)**

Update `buildLetterHTML` to consume the county config and conditionally render:
- **County-specific amendment citations** in each finding (e.g., "Per Miami-Dade County Amendment to FBC 2023 §1626.1")
- **Product approval table** — HVHZ counties get a table listing required NOA numbers; non-HVHZ counties reference FL# approvals
- **Supplemental sections** based on county flags:
  - Wind Mitigation Summary (all counties, enhanced for HVHZ)
  - Flood Zone Compliance Statement (coastal counties)
  - Threshold Building Disclosure (projects over the threshold)
  - Energy Code Compliance Path (varies: prescriptive vs. performance)
- **County building department addressee** in the letter header
- **County-specific closing language** referencing local ordinances

**3. Update the AI edge function prompts (`supabase/functions/ai/index.ts`)**

Enhance the `plan_review_check` and `plan_review_check_visual` system prompts to:
- Receive the county config as context so findings reference the correct local amendments
- Flag which findings need county-specific product approval references
- Add a `county_amendment_ref` field to each finding for the specific local code section

Add a new tool parameter `county_amendment_ref` (optional string) to the `PLAN_REVIEW_TOOL` schema.

**4. Add a "Document Package" export option**

Create a new `CountyDocumentPackage` component that generates multiple documents in one click based on what the county needs:
- Comment Letter (existing, enhanced)
- Product Approval Checklist (HVHZ counties)
- Private Provider Notice form reference
- Inspection Readiness Packet

A dropdown menu on the export button lets users pick individual docs or "Full County Package."

**5. Show county requirements in the review UI**

In `PlanReviewDetail.tsx`, add a small info panel (collapsible) showing "County Requirements for [X]" — listing the specific standards, amendment references, and submission notes so the reviewer knows what to look for before they even start.

### Files to create/edit
- **Create**: `src/lib/county-requirements.ts` — county config registry
- **Edit**: `src/components/CommentLetterExport.tsx` — consume county config, add supplemental sections
- **Edit**: `supabase/functions/ai/index.ts` — add `county_amendment_ref` to tool schema, enrich prompts with county context
- **Edit**: `src/pages/PlanReviewDetail.tsx` — add county requirements info panel, update export section
- **Create**: `src/components/CountyDocumentPackage.tsx` — multi-document export dropdown
