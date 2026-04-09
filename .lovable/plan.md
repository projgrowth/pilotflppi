

# Portal Navigation, Layout & Data Logic Redesign

## Current State Audit

### Information Architecture (Current)

```text
Sidebar (11 items, 3 groups)
├── Operations (5)
│   ├── Dashboard
│   ├── Projects
│   ├── Plan Review      ← separate list, duplicates project sub-view
│   ├── Inspections      ← standalone calendar, no "create" action
│   └── Deadlines        ← read-only view of same projects data
├── Intelligence (3)
│   ├── AI Briefing       ← 2 AI tools, no connection to projects
│   ├── Milestone Radar   ← standalone table, no FK to projects
│   └── Lead Radar        ← standalone table, no FK to projects/contractors
└── Manage (3)
    ├── Contractors       ← CRUD but no link to their projects
    ├── Documents         ← global file dump, duplicates ProjectDetail docs tab
    └── Settings
```

### Problems Identified

**A. Navigation: Too Many Top-Level Items (11)**
- Deadlines is just a filtered view of Projects data -- not a separate concept.
- Plan Review list page duplicates the plan review tab inside ProjectDetail.
- Documents page is a global file dump that duplicates ProjectDetail's documents tab with no added value (no project context, no categories).
- AI Briefing is 2 tools that could be a panel/drawer accessible from anywhere.

**B. Duplicate Paths / Dead Ends**
1. Dashboard "Run AI Check" → navigates to `/plan-review` list (not a specific project) — user lands on a list, not an action.
2. ProjectDetail "Review" button → if no reviews exist, navigates to `/plan-review` list — dead end with no project context.
3. PlanReview "New Review" wizard creates a plan review but asks for project selection again (the user may have just come from that project).
4. Inspections page has no "Schedule Inspection" button — the empty state says "Schedule inspections from project details" but ProjectDetail has no schedule inspection action either. Complete dead end.
5. Documents page uploads files to root storage with timestamp prefixes — completely disconnected from any project. No way to associate uploaded docs.

**C. Contractor (Contact) Data Issues**
1. Contractors page is CRUD-only — no way to see which projects a contractor is linked to.
2. Deleting a contractor doesn't warn about linked projects (no cascade UI).
3. LeadRadar has `contractor_name` as free text — never links to the contractors table.
4. MilestoneRadar has `contact_name/email/phone` — completely separate from contractors, no FK.
5. ProjectDetail shows contractor name in details but no link to contractor record.

**D. Missing Actions**
1. **Inspections**: No "Schedule Inspection" action anywhere in the portal.
2. **ProjectDetail**: No way to edit project fields after creation (county, trade, contractor, address).
3. **ProjectDetail**: No way to change project status manually.
4. **Contractors**: No way to view a contractor's projects.
5. **PlanReview list**: Filter pills use wrong CSS class (`active` instead of `filter-pill-active`).

**E. Inconsistent Behavior**
1. Project creation uses a Dialog on Projects page, but Plan Review creation uses a multi-step wizard Dialog — different patterns for similar actions.
2. Some lists use `grid` column headers (Projects, PlanReview), others use no headers (Contractors, LeadRadar, Documents) — inconsistent table patterns.
3. Settings jurisdictions are local state only — adding/removing jurisdictions is lost on refresh (never persisted to DB).

---

## Proposed Information Architecture

```text
Sidebar (7 items, 2 groups)
├── Core (4)
│   ├── Dashboard          ← overview + deadlines merged
│   ├── Projects           ← all project management
│   ├── Inspections        ← calendar + scheduling
│   └── Contractors        ← contacts hub with linked projects
├── Tools (3)
│   ├── Lead Radar         ← prospecting
│   ├── Milestone Radar    ← building compliance tracking
│   └── Settings           ← profile, firm, preferences
```

**Removed from sidebar:**
- **Deadlines** → merged into Dashboard (already shows deadline data) + Projects filter
- **Plan Review** → accessed only via ProjectDetail (it's a project sub-workflow, not a standalone concept)
- **Documents** → accessed only via ProjectDetail documents tab (global dump removed)
- **AI Briefing** → converted to a slide-out drawer accessible via ⌘K or a global "AI Assistant" button in the header

### Routing Changes
| Old Route | New Behavior |
|-----------|-------------|
| `/deadlines` | Redirect to `/dashboard` |
| `/plan-review` | Redirect to `/projects` |
| `/documents` | Redirect to `/projects` |
| `/ai-briefing` | Removed; AI tools in global drawer |
| `/plan-review/:id` | Keep as-is (deep link into review workspace) |

---

## Page Layout System

Every page follows this hierarchy:
1. **PageHeader** — title, breadcrumbs, primary action button
2. **Alert banner** (conditional) — overdue/urgent items
3. **Summary metrics** (optional) — KPI cards
4. **Filters + search** — filter pills + search input
5. **Primary content** — table/grid/calendar
6. **Secondary content** — sidebar panels, activity feeds

---

## Detailed Changes

### 1. Simplify Sidebar Navigation
**File**: `AppSidebar.tsx`, `CommandPalette.tsx`
- Reduce to 7 items in 2 groups (Core + Tools)
- Remove Deadlines, Plan Review, Documents, AI Briefing nav items
- Update CommandPalette nav items to match
- Add "AI Assistant" shortcut in CommandPalette

### 2. Merge Deadlines into Dashboard
**File**: `Dashboard.tsx`
- Add a "Deadlines" tab or section below KPIs showing the deadline progress bars (currently on Deadlines page)
- Remove separate Deadlines page; add redirect

### 3. Remove Global Documents Page
**File**: `Documents.tsx` → delete or redirect
- All document management happens in ProjectDetail's documents tab
- The global dump added no value and created orphaned files

### 4. Convert AI Briefing to Global Drawer
**Files**: New `AIDrawer.tsx`, `AppLayout.tsx`
- Create a slide-out Sheet with County Code Assistant + Quick Q&A
- Trigger from: sidebar icon button, ⌘K palette, or floating button
- Accessible from any page without navigation

### 5. Fix Contractor as System of Record
**File**: `Contractors.tsx`, `ProjectDetail.tsx`
- **Contractor detail view**: clicking a contractor shows their linked projects (query `projects` where `contractor_id = id`)
- **ProjectDetail**: contractor name in details is a clickable link
- **LeadRadar**: when converting a lead, offer to link to existing contractor or create new one
- Add column headers to Contractors list for consistency

### 6. Add Missing Actions
**File**: `ProjectDetail.tsx`, `Inspections.tsx`
- **ProjectDetail**: Add "Edit Project" button → opens dialog to edit name, address, county, jurisdiction, trade_type, contractor
- **ProjectDetail**: Add "Schedule Inspection" action button → opens dialog to create inspection linked to this project
- **Inspections page**: Add "Schedule Inspection" button in PageHeader → dialog with project selector
- **ProjectDetail**: Add manual status override dropdown (with activity log entry)

### 7. Fix Dead-End Navigation
- Dashboard "Run AI Check" → opens AI drawer instead of navigating to `/plan-review`
- ProjectDetail "Review" button when no reviews exist → opens NewPlanReviewWizard pre-filled with current project
- PlanReview filter pills: fix CSS class from `active` to `filter-pill-active`

### 8. Fix Settings Jurisdictions Persistence
**File**: `Settings.tsx`
- Jurisdictions are currently local state only (lost on refresh)
- Persist to `firm_settings` as a JSONB column, or create a small `firm_jurisdictions` table
- Migration: add `jurisdictions jsonb default '[]'` to `firm_settings`

### 9. Data Relationship Audit & Fixes
| Issue | Fix |
|-------|-----|
| `permit_leads.contractor_name` is free text | Add optional `contractor_id` FK; keep text as fallback display |
| `milestone_buildings` contact fields are standalone | Keep as-is (these are external building contacts, not FPP contractors) |
| Deleting contractor with linked projects | Add confirmation dialog showing linked project count |
| `projects.assigned_to` never shown in UI | Show assignee in ProjectDetail; allow setting in edit dialog |

### 10. Standardize Table Patterns
- All list pages get column headers row (currently missing from Contractors, LeadRadar)
- All list rows are clickable with `ChevronRight` indicator
- Contractors rows → click to expand/navigate to detail

### 11. Route Redirects
**File**: `App.tsx`
- `/deadlines` → redirect to `/dashboard`
- `/plan-review` → redirect to `/projects`  
- `/documents` → redirect to `/projects`
- `/ai-briefing` → redirect to `/dashboard`
- Keep `/plan-review/:id` as direct workspace link

---

## Files Modified / Created

| File | Action |
|------|--------|
| `src/components/AppSidebar.tsx` | Reduce to 7 nav items |
| `src/components/CommandPalette.tsx` | Update nav items, add AI shortcut |
| `src/components/AIDrawer.tsx` | **New** — global AI assistant drawer |
| `src/components/AppLayout.tsx` | Add AIDrawer |
| `src/App.tsx` | Add redirects for removed routes |
| `src/pages/Dashboard.tsx` | Add deadlines section |
| `src/pages/Projects.tsx` | Add "Deadline" filter |
| `src/pages/ProjectDetail.tsx` | Add Edit, Schedule Inspection, status override, contractor link |
| `src/pages/Inspections.tsx` | Add "Schedule Inspection" button + dialog |
| `src/pages/Contractors.tsx` | Add column headers, click-to-detail with linked projects |
| `src/pages/PlanReview.tsx` | Fix filter pill CSS; keep as redirect target |
| `src/pages/Settings.tsx` | Persist jurisdictions to DB |
| `src/pages/Deadlines.tsx` | Convert to redirect |
| `src/pages/Documents.tsx` | Convert to redirect |
| `src/pages/AIBriefing.tsx` | Convert to redirect |
| `supabase/migrations/` | Add `jurisdictions` column to `firm_settings` |

---

## What This Achieves

- **11 → 7 sidebar items**: Simpler top-level choices
- **0 dead ends**: Every button routes to a real action
- **0 duplicate paths**: Plan reviews and documents live inside their project
- **Contractors as system of record**: Linked projects visible, deletions guarded
- **Consistent patterns**: All lists have headers, all rows are clickable, all pages use PageHeader
- **AI tools always available**: Global drawer instead of a separate page
- **Data propagation**: Edits to projects/contractors reflect everywhere via query invalidation

