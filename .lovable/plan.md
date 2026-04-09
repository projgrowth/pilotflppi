
# Phase B: F.S. 553.791 Statutory Deadline Enforcement

## What This Does

Adds proper Florida Private Provider statute (F.S. 553.791) deadline tracking to the platform:
- **30 business-day** plan review window (clock starts at notice filing, resets on resubmission)
- **10 business-day** inspection window (clock starts when inspection is scheduled)
- Visual indicators showing both statutory and contractual deadlines
- Automated alerts as statutory limits approach

## Database Changes

**Add columns to `projects` table** via migration:
- `statutory_review_days INTEGER DEFAULT 30` — configurable per project
- `statutory_inspection_days INTEGER DEFAULT 10`
- `statutory_deadline_at TIMESTAMPTZ` — computed statutory deadline
- `review_clock_started_at TIMESTAMPTZ` — when the review clock started/last reset
- `review_clock_paused_at TIMESTAMPTZ` — for clock-stop on resubmission requests

**Create `statutory_alerts` table**:
- `id`, `project_id`, `alert_type` (review_5day, review_3day, review_1day, inspection_3day, inspection_1day, statutory_overdue), `triggered_at`, `acknowledged`
- RLS: authenticated users can read and update

**Add a database function** `compute_statutory_deadline()` that calculates business-day deadlines excluding weekends (F.S. 553.791(4) allows exclusion of weekends/holidays).

**Add a trigger** on `plan_reviews` INSERT: when a new round is created, reset `review_clock_started_at` on the parent project (clock reset per statute on resubmission).

## Frontend Changes

### 1. Statutory deadline utilities (`src/lib/statutory-deadlines.ts`)
- `getBusinessDaysElapsed(startDate)` — counts business days from start
- `getBusinessDaysRemaining(startDate, totalBusinessDays)` — remaining business days
- `getStatutoryStatus(project)` — returns `{ reviewDaysUsed, reviewDaysTotal, inspectionDaysUsed, inspectionDaysTotal, isOverdue, phase }`

### 2. Update `DeadlineBar.tsx` and `DeadlineRing.tsx`
- Accept optional `statutory` prop to show business-day-based progress
- When statutory mode is on, show "Business Day X/30" instead of calendar days
- Add a second thin bar or ring segment for the statutory deadline when both exist

### 3. Update `ProjectDetail.tsx`
- Add a "Statutory Clock" card in the project detail view showing:
  - Review clock: business days used / 30, with color coding
  - Inspection clock: business days used / 10 (when in inspection phase)
  - Clock status indicator (running, paused, reset)

### 4. Update `Deadlines.tsx`
- Add a "Statutory" filter tab
- Show statutory deadline column alongside the existing contractual deadline
- Flag projects approaching statutory limits with a gavel/statute icon

### 5. Update `Dashboard.tsx`
- Add a KPI card: "Statutory Due" count (projects within 5 business days of statutory limit)
- Overdue banner includes statutory overdue projects

### 6. Update `useProjects.ts`
- Extend `Project` interface with new statutory fields
- Add `getStatutoryDaysRemaining()` helper

## Implementation Order

1. Database migration (new columns + function + trigger)
2. `src/lib/statutory-deadlines.ts` utility module
3. Update `useProjects.ts` interface and helpers
4. Update `DeadlineBar` and `DeadlineRing` components
5. Update `ProjectDetail.tsx` with statutory clock card
6. Update `Deadlines.tsx` with statutory filter and column
7. Update `Dashboard.tsx` KPI and overdue banner
