

# Add Zoning & Commercial Project Capabilities

## What exists today

Your platform already handles plan visualization well — PDFs are rendered as zoomable/pannable images with AI-placed annotations linked to findings. The AI uses Gemini vision to analyze actual plan sheets and flag FBC 2023 violations across 9 disciplines. County-specific rules (HVHZ, wind loads, product approvals) are already wired in.

## What's missing for large commercial projects

### 1. Zoning & Lot Allowance Module (new feature)

A dedicated "Zoning" tab in the project workspace where users input or the AI extracts:

| Field | Example (Porsche Dealership) |
|-------|------------------------------|
| Zoning district | C-2 (General Commercial) |
| Lot area | ~2.5 acres |
| Building footprint | 70,000 sqft |
| FAR (Floor Area Ratio) | Max 0.5 → allows 54,450 sqft on 2.5ac |
| Lot coverage | Max 60% |
| Setbacks | Front 25', Side 10', Rear 15' |
| Max height | 45' / 3 stories |
| Parking required | 1 per 200 sqft showroom, 1 per 400 sqft service |
| Landscape buffer | 15' along ROW |
| Signage allowance | 1 sqft per LF of frontage |

This would calculate compliance automatically (e.g., "70K sqft exceeds FAR on this lot — needs variance") and flag issues before plan review begins.

### 2. Commercial Occupancy Classification

Add occupancy-aware logic to the AI review system:
- Auto-detect occupancy groups (B for offices, S-1 for service bays, M for showroom, F-1 for paint booth)
- Flag mixed-occupancy fire separation requirements (FBC Table 508.4)
- High-piled storage requirements for parts warehouses
- Auto repair bay ventilation (IMC 502.16) and flammable liquid storage

### 3. Enhanced AI Prompt for Commercial Scale

Extend the edge function's system prompt with commercial-specific instructions covering:
- Multi-occupancy separation analysis
- Parking & accessibility calculations (ADA van spaces per lot size)
- Means of egress for large floor plates (travel distance, exit capacity)
- Fire sprinkler/alarm thresholds based on building area and occupancy

## Files changed

| File | Change |
|------|--------|
| `src/components/ZoningAnalysisPanel.tsx` | **New** — Zoning input form + compliance calculator |
| `src/pages/ProjectDetail.tsx` | Add "Zoning" tab rendering ZoningAnalysisPanel |
| `supabase/functions/ai/index.ts` | Add `zoning_analysis` action + commercial-enhanced prompts |
| `src/lib/zoning-utils.ts` | **New** — FAR/coverage/parking/setback calculation helpers |
| Migration | Add `zoning_data` JSONB column to `projects` table |

## Implementation approach

- The zoning panel lets users manually enter district parameters OR paste a zoning code designation, then the AI looks up typical requirements for that district.
- Calculations run client-side for instant feedback (FAR, coverage %, parking count).
- The AI review prompt gets a commercial addendum so it checks occupancy separation, high-piled storage, and auto repair bay code sections when the project trade type or square footage indicates commercial scale.
- No changes to the existing plan viewer — it already handles multi-page visualization and annotation.

