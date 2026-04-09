

# Redesign: AI Briefing Page Layout

## Current Issues

The page has three panels crammed into a 3/5 + 2/5 grid with poor space usage:
- Activity feed takes prime real estate but shows minimal data (just timestamps)
- Two separate AI input areas (Quick Code Q&A + County Chatbot) compete for attention
- The chatbot is squeezed into a narrow 2/5 column
- No KPI summary or at-a-glance intelligence
- No visual hierarchy — everything looks the same weight

## Proposed Layout

Restructure into a **dashboard-style intelligence hub** with clear visual hierarchy:

```text
┌─────────────────────────────────────────────────┐
│  AI Briefing                                     │
│  "3 projects nearing statutory deadline"  banner │
├──────────┬──────────┬──────────┬────────────────┤
│ Active   │ Pending  │ Statutory│ Reviews This   │
│ Reviews  │ Comments │ Alerts   │ Month          │
├──────────┴──────────┴──────────┴────────────────┤
│                                                  │
│  ┌─── County Code Assistant (full width) ──────┐│
│  │  County picker + HVHZ/CCCL badges           ││
│  │  Quick question chips                        ││
│  │  Chat area (taller, more room)               ││
│  │  Input bar                                   ││
│  └──────────────────────────────────────────────┘│
│                                                  │
│  ┌─── Two columns below ───────────────────────┐│
│  │  Quick Code Q&A          │  Activity Feed    ││
│  │  (General FBC questions) │  (compact sidebar)││
│  └──────────────────────────┴───────────────────┘│
└──────────────────────────────────────────────────┘
```

## Key Changes

### 1. Add KPI row at the top
Pull stats from `useDashboardStats` — show Active Reviews, Pending Comments, Statutory Alerts, and Completed MTD as compact KPI cards, matching the Dashboard style.

### 2. Promote County Chatbot to full-width hero
The chatbot is the primary tool on this page. Give it the full width with a taller height (~500px), making the chat area much more usable.

### 3. Demote Activity Feed to compact sidebar
Move the activity feed into a smaller right column below the chatbot, matching the Dashboard's `CompactActivityFeed` pattern. It's useful context but not the main action.

### 4. Keep Quick Code Q&A as a secondary card
Place it in the left column below the chatbot — same width as the activity feed column.

### 5. Visual polish
- Add a contextual alert banner when statutory deadlines are approaching (reuse overdue pattern from Dashboard)
- Use the same `KpiCard` component from Dashboard for consistency
- Give the chatbot card a subtle accent border to signal it's the primary interaction

## Files Changed

| File | Change |
|------|--------|
| `src/pages/AIBriefing.tsx` | Restructure layout: KPI row, full-width chatbot, two-column bottom section |

No new components, hooks, or database changes needed — just reorganizing existing pieces and importing `KpiCard` + `useDashboardStats`.

