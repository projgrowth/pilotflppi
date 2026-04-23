

# Plan Review UX Audit — Less Busy, Less Confusing

The system is *featurefull*. Reviewers see four stacked banners, a six-chip health strip, seven tabs, and dense finding cards covered in badges before they touch a single deficiency. Below is what makes it feel busy and the focused changes that reduce cognitive load without removing capability.

## What's actually wrong (observed in the codebase, not guessed)

```text
ReviewDashboard top of page renders, in order:
  1. PageHeader + 4 action buttons
  2. Re-prepare banner (conditional)
  3. DnaHealthBanner (conditional)
  4. CitationDbBanner
  5. ReviewHealthStrip   ← already has 6 popover chips
  6. ReviewerMemoryCard  ← duplicates the "Memory" chip in #5
  7. LetterQualityGate
  8. Tabs (7 of them)
       Triage | All Findings | Human Review | Deferred | Dedupe Audit
       | Project DNA | Sheet Coverage

DeficiencyCard renders, per finding:
  def_number · discipline · confidence · verification badge
  + LIFE SAFETY + PERMIT BLOCKER + LIABILITY + NEEDS HUMAN EYES
  + citation badge + provenance popover + reviewed badge
  + finding text + required action + sheet chips + "Open A-101" button
  + Confirm / Reject / Modify buttons + status select + notes textarea

Two parallel reviewer surfaces with different keyboard maps:
  /plan-review/:id           J/K=findings, R=reposition, S=resolved, X=defer
  /plan-review/:id/dashboard J/K=findings, C=confirm, R=REJECT (same key, diff meaning)
```

So a reviewer sees ~15 things competing for attention before a finding, then 8+ controls per finding, and the same key does two different actions depending on which page they're on.

---

## 1. Collapse the dashboard chrome (biggest visual win)

Replace the 4-stacked banners + health strip + memory card with a **single sticky workspace header**. Content the reviewer doesn't need until something is wrong gets one severity-coded "Issues" chip that opens a popover.

```text
BEFORE                                   AFTER
Re-prepare banner  ───┐                  ┌─ Sticky header bar ──────────────┐
DNA banner            │                  │ Project · Round 3 · Plan Review  │
Citations banner      │  → all merge →   │ ● Healthy   12 findings · 3 need │
Health strip (6 chips)│                  │ eyes · Memory: 4 applied         │
Memory card           │                  │ [Issues 0] [Run Deep] [Letter]   │
Letter quality gate   ┘                  └──────────────────────────────────┘
                                         (banners only render if active &
                                          collapse into the Issues chip)
```

Concrete moves:

- Delete `ReviewerMemoryCard` from `ReviewDashboard` (it's already inside the Memory chip on `ReviewHealthStrip`).
- Move the **Re-prepare**, **DNA**, **Citations**, and **Letter Quality Gate** banners into a single `<DashboardAlertStack>` that:
  - Renders **at most one** alert at a time (prioritized: re-prepare > DNA blocker > letter blocker > citations) with a "+2 more" button revealing the rest in a popover.
  - Uses one consistent layout (icon · title · one-line action) instead of four custom layouts.
- Make the health strip **sticky** to the top of the scroll container so the chips are always reachable, not buried after 4 banners.

Result: the reviewer lands on findings, not on a wall of meta.

## 2. Merge the seven tabs into three, demote the rest to filter chips

Reviewers don't think *"I'll switch tabs to look at deferred scope now."* They think *"show me what I haven't triaged yet."* Replace tabs with a focused tri-mode:

```text
BEFORE                              AFTER
[Triage] [All] [Human] [Deferred]   [Triage] [All findings] [Audit & Coverage]
[Audit] [DNA] [Coverage]                ↑                       ↑
                                        contains: human-review,  contains: dedupe,
                                        deferred, low-confidence  DNA, sheet
                                        as filter chips           coverage as
                                                                  inner tabs
```

- **Triage** stays the default. Add inline filter chips ("Needs eyes 3", "Life safety 1", "Low confidence 5", "Deferred 2") that simply pre-filter the same list — no tab swap.
- **All findings** = current `DeficiencyList` with the existing filters.
- **Audit & Coverage** combines the three least-used tabs (Dedupe Audit, Project DNA, Sheet Coverage) behind a sidebar inside one tab. They're inspection surfaces, not workflow.

Cuts top-level navigation from 7 → 3, and the filter-chip pattern is reusable for the workspace page too.

## 3. Make the deficiency card scannable

A reviewer looking at 30 findings should be able to read them like a list, not parse a 12-element header. Two structural moves:

- **Collapse the four flag tags** (`LIFE SAFETY`, `PERMIT BLOCKER`, `LIABILITY`, `NEEDS HUMAN EYES`) into a **single colored left rail** on the card + one badge that says the worst flag. The full set lives in a tooltip on hover. Today the priority is encoded in 4 places (rail, badge color, text tag, bg). Pick one.
- **Hide secondary controls until the card is focused.** Notes textarea, status select, and provenance popover render only when the card is `isActive` (already tracked by triage controller). The collapsed card shows: number + finding + required action + sheets + Confirm/Reject/Modify. This alone halves visual noise on a 20-card page.

```text
COLLAPSED CARD (default)             EXPANDED (active)
│ ▌ #M-3  Mechanical · 0.82          │ ▌ #M-3  Mechanical · 0.82  [VERIFIED]
│   Finding text…                    │   Finding text…
│   Required: install duct…          │   Required: install duct…
│   [A-101]  [✓ Confirm] [✗] [✎]     │   [A-101] [Open]  Status: Open ▾
                                     │   Reviewer notes…
                                     │   Provenance · Citations
                                     │   [✓ Confirm] [✗ Reject] [✎ Modify]
```

## 4. Unify the two reviewer surfaces and one keyboard map

Today `R` means "reposition pin" on the workspace and "reject finding" on the dashboard — same hand, opposite outcomes. Two changes:

- **Single keyboard contract** (`src/lib/review-shortcuts.ts`):
  - `J/K` next/prev finding (both pages)
  - `Enter` open active finding in viewer
  - `C` confirm · `Shift+R` reject · `M` modify · `S` mark resolved
  - `?` shortcut overlay
  - Drop the bare `R` for reposition (pin repositioning is unsupported on v2 anyway — already toasts an error).
- **Promote the dashboard inside the workspace as a right-side drawer.** Keep the URLs as they are, but add a "Dashboard" toggle in `ReviewTopBar` that slides the triage inbox over the right panel. Reviewers no longer have to navigate away from the PDF to triage; clicking a finding in the drawer scrolls the PDF to that sheet (the `?page=N` link already exists in `DeficiencyHeader`).

Also: rename the workspace page header from generic "Plan Review" to **"Workspace"** and the dashboard to **"Triage"** so the two modes have distinct identities.

## 5. Make "what to do next" obvious

Right now after the AI finishes a reviewer sees a list and has to invent a workflow. Add a **single guided next-step bar** above the tab list:

```text
┌─────────────────────────────────────────────────────────────────┐
│  Step 2 of 4 · Triage findings                                   │
│  3 need your review now → [Start triage] (J to navigate)         │
└─────────────────────────────────────────────────────────────────┘
```

The four implicit steps are already there in the data, just unsurfaced:

1. **Pipeline running** → show stepper
2. **Triage** → 27 untouched findings
3. **Generate letter** → letter draft empty or stale
4. **QC sign-off** → `qc_status === 'pending_qc'`

The bar reads the existing state (deficiency dispositions, `comment_letter_draft`, `qc_status`) and shows exactly one CTA. No new data.

## 6. Quieter visual system

Small, consistent moves that compound:

- **One severity color per concept.** Today life-safety is destructive-red, human-review is amber, permit-blocker is orange, liability is amber. Reduce to three: red (life safety / blocker), amber (needs attention), neutral (informational). Map all flags to those.
- **Drop the colored bg-tinted chips on the health strip** in favor of monochrome chips with a tiny colored dot. The strip currently has 6 different bg tints — feels noisy even when nothing's wrong.
- **Replace the `animate-pulse` "Run AI Check" button** in `ReviewTopBar` with a static accent border per project memory — pulsing demands attention even when the user has nothing to do about it.
- **Hide the page-cap warning bar** when reviewing ≤10 sheet projects (it currently always renders if total > rendered, even when total = rendered).
- **Move "Re-run Core" and "Re-run Deep" into a single "Re-run ▾" dropdown** in the dashboard header. Deep is rarely needed; it shouldn't take equal real estate to Core.

## 7. Minor cleanup that surfaces while there

- Default the dashboard to landing on the **active alert** if any exist (re-prepare needed, DNA blocker, etc.) instead of always Triage. Skip the alerts in the empty case — Triage stays default.
- The "Re-run Core" button is `variant="ghost"` while "Run Deep QA" is `variant="outline"` and "Generate Report" is `variant="default"`. Pick one hierarchy: Generate Report (primary), Re-run (secondary), Cancel (destructive). Today buttons compete.
- `isPipelineActive` hides the Cancel button when there's no active row but leaves the page silent if the previous run errored. Show a small "Last run: error at sheet_map · Retry" status next to the title bar.

---

## Suggested execution order

1. **Header collapse + remove duplicate `ReviewerMemoryCard`** — instant decluttering, no logic changes.
2. **Tabs 7 → 3 + filter chips** — same data, fewer surfaces.
3. **Card collapse-when-inactive** — biggest "less busy when scrolling 30 findings" win.
4. **Unified keyboard map + Dashboard-as-drawer in workspace** — eliminates the surface duplication.
5. **Guided next-step bar** — gives every reviewer the same workflow regardless of seniority.
6. **Visual polish** — color reduction, button hierarchy, animation removal.

No DB schema changes. No edge function changes. All changes are in `src/pages/ReviewDashboard.tsx`, `src/pages/PlanReviewDetail.tsx`, the `review-dashboard/` and `plan-review/` component folders, plus one new `src/lib/review-shortcuts.ts` for the unified keyboard map.

