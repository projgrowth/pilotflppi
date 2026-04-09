

# Platform-Wide Audit & Improvement Plan for Florida Private Providers

## What a Private Provider Inspector Would Flag

After reviewing every major module, here are the gaps and precision improvements organized by priority.

---

## A. Plan Review Logic & Knowledge Gaps

### 1. Comment Letter Says "21 Calendar Days" — Statute Says 30 Business Days
The `CommentLetterExport.tsx` (line 261) states: *"completed within the statutory 21-calendar-day review period"*. This is wrong per F.S. 553.791(4)(b) which provides **30 business days** for plan review. The statutory-deadlines module already has the correct 30-day logic, but the comment letter wasn't updated to match.

**Fix**: Update comment letter language to reference "30-business-day" statutory review period instead of "21-calendar-day."

### 2. Inspection Window Not Tracked Separately
The `statutory-deadlines.ts` (line 98-100) has a comment: *"simplified — in full impl would track separately."* The 10-business-day inspection clock should start from when the inspection is **requested/scheduled**, not from `review_clock_started_at`. This needs its own `inspection_clock_started_at` column.

**Fix**: Add `inspection_clock_started_at` to the `projects` table. Set it when an inspection is scheduled. Use it for the inspection countdown.

### 3. AI Prompt Hardcodes Finding Counts ("Produce 8-12 findings")
The AI edge function (line 44) instructs the model to *"Produce 8-12 findings."* A real Private Provider review should produce findings based on **what's actually wrong**, not a target count. This creates false positives or suppresses real issues.

**Fix**: Change the prompt to: "Report ALL code violations and deficiencies found. Do not pad with advisory items to meet a count. If fewer than 3 real issues exist, say so."

### 4. No FBC Edition Validation
The AI mentions checking code edition mismatch but the system never validates which FBC edition the plans were designed to. Plans stamped under the 7th Edition (2020) being reviewed against 8th Edition (2023) criteria could produce incorrect findings.

**Fix**: Add an `fbc_edition` field to `plan_reviews` that the AI extraction step populates. Show a warning banner when the detected edition doesn't match 8th Edition.

### 5. Missing "Hold for Resubmission" Clock Pause Logic
When a Private Provider issues comments (status = `comments_sent`), F.S. 553.791 allows the review clock to **stop** until the applicant resubmits. Currently `review_clock_paused_at` exists in the schema but nothing sets it automatically.

**Fix**: Auto-set `review_clock_paused_at = NOW()` when status changes to `comments_sent`. Clear it when status changes to `resubmitted`.

### 6. Checklist Not Persisted
`DisciplineChecklist.tsx` stores checked items in local React state. If you navigate away and come back, all manual checkmarks are lost. A real reviewer needs persistent checklists.

**Fix**: Persist checklist state to the `plan_reviews.finding_statuses` JSONB column (or a dedicated `checklist_state` JSONB column).

### 7. Inspection Checklists Are Too Generic
The inspection checklists (`tradeChecklists` in `Inspections.tsx`) have 5 items per trade with no code references. A real FPP inspector needs FBC-referenced checklists with 15-25 items per discipline covering specific code sections.

**Fix**: Expand checklists with FBC/NEC/FPC/FMC section references, matching the level of detail in `DisciplineChecklist.tsx`.

---

## B. Statutory & Compliance Gaps

### 8. No Florida Holiday Exclusion
`isBusinessDay()` only excludes weekends. F.S. 553.791(4) allows exclusion of state holidays (New Year's, MLK Day, Memorial Day, July 4th, Labor Day, Veterans Day, Thanksgiving, Christmas, etc.). Missing these could miscalculate deadlines by 8-10 days/year.

**Fix**: Add a Florida state holiday calendar to `statutory-deadlines.ts`.

### 9. No Resubmission Deadline Tracking
When comments are sent, the applicant has a county-specific resubmission window (e.g., 14 days for most counties). This isn't tracked or surfaced anywhere in the UI.

**Fix**: Calculate and display `resubmission_deadline = comments_sent_date + county.resubmissionDays`. Add it to the Deadlines page and project detail.

### 10. No "Deemed Approved" Warning
Per F.S. 553.791(4)(b), if the building official doesn't act within 30 business days, the plans are **deemed approved**. The system should warn when approaching this threshold and auto-flag projects that cross it.

**Fix**: Add a "DEEMED APPROVED" status and auto-flag logic when `reviewDaysRemaining <= 0` and no action has been taken.

### 11. Certificate of Compliance Generation Missing
After a passing inspection, F.S. 553.791(9) requires the Private Provider to issue a Certificate of Compliance. The system marks `certificate_issued = true` but doesn't generate the actual certificate document.

**Fix**: Add a Certificate of Compliance PDF template with required statutory language, project details, inspection results, and reviewer signature block.

---

## C. UX & Workflow Improvements

### 12. Finding Confidence Level Not Surfaced in UI
The AI returns a `confidence` field ("verified" | "likely" | "advisory") but `FindingCard.tsx` never displays it. This matters for QC — a reviewer should know which findings the AI is certain about vs. guessing.

**Fix**: Show confidence as a subtle badge or icon on each finding card.

### 13. No Batch Status Actions for Findings
Reviewers often need to mark multiple findings as resolved at once (e.g., after reviewing a resubmission). Currently they must click each one individually.

**Fix**: Add "Select All" / "Mark Selected as Resolved" batch actions to the findings panel.

### 14. Plan Review → Inspection Handoff
When a project transitions from plan review to inspection, there's no structured handoff. The inspector should see a summary of: open findings from the last review round, the approved plans, and any conditions of approval.

**Fix**: Create an "Inspection Brief" auto-generated from the latest plan review findings and project context, shown when opening an inspection.

### 15. No Photo/Evidence Capture on Inspections
Field inspections require photo documentation. There's no way to attach photos to inspection results.

**Fix**: Add photo upload capability to the inspection sheet, stored in Supabase Storage under `inspections/{id}/photos/`.

---

## Implementation Priority

| Priority | Items | Effort |
|----------|-------|--------|
| **Critical** (legal accuracy) | #1, #2, #3, #5, #8, #10 | Medium |
| **High** (professional quality) | #4, #6, #7, #9, #11 | Medium |
| **Nice-to-have** (UX polish) | #12, #13, #14, #15 | Light-Medium |

## Recommended Approach

Implement in **3 sprints**:

**Sprint 1 — Legal Accuracy** (items 1, 2, 3, 5, 8, 10): Fix the comment letter language, add inspection clock tracking, fix AI prompt, auto-pause/resume clocks, add holiday exclusions, and add "deemed approved" logic.

**Sprint 2 — Professional Quality** (items 4, 6, 7, 9, 11): Add FBC edition detection, persist checklists, expand inspection checklists with code refs, track resubmission deadlines, and generate Certificate of Compliance PDFs.

**Sprint 3 — UX Polish** (items 12, 13, 14, 15): Surface confidence levels, batch finding actions, inspection handoff briefs, and photo capture.

