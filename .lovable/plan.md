

## Plan: Redesign Project Detail & Dashboard Pages

Looking at the screenshot and current code, here are the specific improvements:

### Project Detail Page (`src/pages/ProjectDetail.tsx`)

**1. Horizontal stepper timeline instead of vertical list**
Replace the tall vertical timeline card with a compact horizontal step indicator — similar to Stripe's checkout progress. Each step is a small dot or pill connected by a line, with labels below. Completed steps get a filled dot, current step gets an accent ring, future steps are muted. This cuts the card height by ~60% and feels modern.

**2. Better layout proportions**
Change from 3/5 + 2/5 split to a cleaner 3-column grid: timeline spans full width at top, then details + deadline ring side by side below, then tabs below that. This eliminates the awkward vertical stacking.

**3. Deadline ring refinement**
Make the ring smaller and inline it into a combined "Status & Deadline" card alongside key metadata (county, trade, contractor) rather than isolating it in its own card. Show the deadline as text like "18 days left" with a subtle progress bar instead of the large circular ring on the detail page.

**4. Details card cleanup**
Format "Services" values properly (title case instead of raw DB values like "Plan_review"). Remove em-dash placeholders for empty fields — just hide rows with no data. Add subtle row hover states.

**5. Quick actions as icon buttons**
Replace the two bottom buttons with a single-row action bar integrated into the page header area (next to the status chip), using icon-only or compact buttons.

### Dashboard Page (`src/pages/Dashboard.tsx`)

**6. Stats as clickable metric cards**
Replace the tiny inline stats text with 3-4 proper KPI cards in a row (like Stripe's dashboard metrics): "Active Projects", "Due This Week", "Completed MTD", "Avg Review Time". Each with the number large, label small below, and clickable to navigate.

**7. Merge "Needs Attention" and "In Progress" sections**
These currently show overlapping data. Combine into a single smart table/list with sortable columns: Project, Status, Days Remaining, Last Activity. This is more scannable and avoids redundancy.

**8. Activity feed with project links**
Make activity items clickable, navigating to the relevant project. Add project name context to each entry.

**9. Remove greeting verbosity**
Keep the greeting but make it a single line with the date inline, not a separate subtitle. Tighten vertical spacing.

### Technical approach
- Edit `src/pages/ProjectDetail.tsx` — rewrite timeline to horizontal stepper, restructure layout grid, inline deadline into details card
- Edit `src/pages/Dashboard.tsx` — add KPI cards row, merge attention/progress into unified list, tighten header
- Edit `src/components/DeadlineRing.tsx` — add a compact "bar" variant for inline use
- Minor tweaks to `src/components/StatusChip.tsx` for consistent sizing

