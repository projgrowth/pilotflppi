

# Upgrade Plan Review & AI Intelligence — County-Specific, Comprehensive, Aesthetic

## Summary

Transform the Plan Review page into a professional-grade, county-aware code review tool with rich UI, and upgrade the AI prompts to produce deeply specific, trustworthy findings tied to Florida county/jurisdiction requirements.

---

## 1. Enhanced AI System Prompts (Edge Function)

**File: `supabase/functions/ai/index.ts`**

Rewrite `plan_review_check` prompt to be county-aware and far more comprehensive:

- Include county/jurisdiction context: differentiate HVHZ (Miami-Dade, Broward) from non-HVHZ counties
- Require the AI to reference specific FBC 2023 sections, Florida Statutes, and county amendments
- Demand findings organized by discipline (Structural, Life Safety/Egress, Fire Protection, MEP, Energy, ADA, Site/Civil)
- Require a confidence level per finding ("verified", "likely", "advisory")
- Add a `discipline` field and `county_specific` boolean to the JSON schema
- Require minimum 8-12 findings for realism and comprehensiveness

Updated JSON output schema:
```text
{
  severity: "critical" | "major" | "minor",
  discipline: "structural" | "life_safety" | "fire" | "mechanical" | "electrical" | "plumbing" | "energy" | "ada" | "site",
  code_ref: "FBC 2023 Section ...",
  county_specific: true/false,
  page: "sheet ref",
  description: "...",
  recommendation: "...",
  confidence: "verified" | "likely" | "advisory"
}
```

Update `generate_comment_letter` prompt to:
- Include the county name and jurisdiction in the letterhead context
- Reference county-specific amendments when `county_specific` is true
- Group deficiencies by discipline with numbered items
- Include the firm's license info placeholder and proper FPP letterhead format

## 2. Redesigned Plan Review Page

**File: `src/pages/PlanReview.tsx`** — Major rewrite

### Queue View (main list)
- Add column headers: Project, Trade, County, Round, Status, Findings
- Show a summary bar at top: total reviews, pending, complete, with findings count
- Color-code rows by urgency (reviews with critical findings get a red left border)

### Detail Panel (Sheet) — Expanded to full review workspace
- **Header**: Project name, address, county badge, jurisdiction, trade type pill, round indicator
- **County Context Banner**: When project is in HVHZ county (Miami-Dade, Broward), show a distinct banner: "HVHZ Zone — Enhanced wind load & impact protection requirements apply"
- **AI Pre-Check Button**: Larger, more prominent with county name in label: "Run AI Pre-Check (Miami-Dade)"
- **Progress Animation**: Replace simple pulse with a multi-step scanning indicator showing disciplines being checked (Structural → Life Safety → Fire → MEP → Energy → ADA)

### Findings Display — Grouped by Discipline
- Group findings into collapsible discipline sections (Structural, Life Safety, Fire, etc.)
- Each section header shows finding count and worst severity
- Each finding card:
  - Severity badge (color-coded) + confidence indicator (checkmark/question mark)
  - County-specific flag with a small "County Amendment" tag when applicable
  - Code reference in monospace, clickable feel
  - Description in clear prose
  - Recommendation in a subtle callout box
- Summary statistics bar: X critical, Y major, Z minor — with visual breakdown

### Comment Letter Section
- Styled as a document preview with letterhead appearance (border, padding, serif-like rendering)
- "Copy" and "Download as PDF" buttons (copy only for now, PDF placeholder)
- Editable textarea with monospace font for professional look

## 3. Enhanced Finding Card Component

**New file: `src/components/FindingCard.tsx`**

Reusable card for individual findings with:
- Left color bar by severity
- Discipline icon (wrench for MEP, shield for fire, etc.)
- Confidence indicator
- County-specific amendment badge
- Expandable recommendation section

## 4. County Context Utilities

**New file: `src/lib/county-utils.ts`**

Helper functions:
- `isHVHZ(county: string): boolean` — returns true for Miami-Dade, Broward
- `getCountyLabel(county: string): string` — formatted display
- `getDisciplineIcon(discipline: string)` — maps discipline to Lucide icon
- `getDisciplineColor(discipline: string)` — maps discipline to color class

## 5. Updated AI Payload (Frontend)

Pass `county` and `jurisdiction` from the project to the AI call so the prompt can tailor findings to the specific locality.

## 6. Seed More Realistic Plan Review Data

**Migration**: Add 2 more plan reviews for projects in different counties (Palm Beach, Sarasota) to showcase county variation.

---

## Technical Details

- **Edge function changes**: Only prompt text changes + updated JSON schema in the system prompt — no structural changes to the function
- **Tool calling for structured output**: Switch from asking the AI for raw JSON to using the tool-calling pattern for reliable structured extraction of findings
- **No new dependencies**: All UI built with existing shadcn components (Accordion for discipline groups, Badge, Card)
- **Files modified**: `supabase/functions/ai/index.ts`, `src/pages/PlanReview.tsx`
- **Files created**: `src/components/FindingCard.tsx`, `src/lib/county-utils.ts`
- **Migration**: 1 small seed migration for additional plan reviews

