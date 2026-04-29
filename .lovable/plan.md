## Three fixes for the review/projects UI

### 1. Duplicate "Triage" labels in the review dashboard

The dashboard route (`/plan-review/.../dashboard`) currently shows the word **Triage** four times stacked above each other:

1. `PageHeader` title — "Triage"
2. The `<TabsTrigger value="triage">` — "Triage" (with a count badge)
3. Inside `TriageInbox`, the progress card header — "Triage queue · X of Y reviewed"
4. The bare-R/C/M shortcut hint paragraph repeats "triage" again in copy

This reads as label noise. Same redundancy exists on the **All findings** tab where `DeficiencyList` renders its own "Triage progress · X of Y" card immediately under the page-level "Triage" header.

**Fix**
- Rename the page header from "Triage" to **"Review dashboard"** (matches the route name and the tab system below it). Subtitle stays as the project name + round.
- In `TriageInbox`, change the progress card label from "Triage queue · X of Y reviewed" to **"Progress · X of Y reviewed"** (the surrounding tab already says Triage).
- In `DeficiencyList` (All-findings tab), change "Triage progress · X of Y" to **"Reviewed · X of Y"** so it's clearly different from the Triage tab's progress meter.
- Trim the shortcut-hint paragraph to a single line: `J/K move · C confirm · Shift+R reject · M modify`. Drop the redundant "Sorted by urgency…" sentence (it's already implied by the priority order and discoverable via the Shortcuts overlay).

### 2. Multi-select + bulk delete on the Projects page

`src/pages/Projects.tsx` only supports single-row delete via a hover-only trash icon. Add a familiar Linear/GitHub-style bulk pattern:

- Add a leading checkbox column (always visible — replaces the empty 40px gutter on the left of each row, the `DeadlineRing` shifts right slightly).
- Header row gets a "select all visible" checkbox.
- When 1+ rows are selected, a **sticky action bar** slides in at the bottom of the card:
  `3 selected · [Clear] [Delete selected]`
- "Delete selected" opens a single `DeleteConfirmDialog` requiring the user to type the literal string `delete N projects` (where N is the count) — same typed-confirmation pattern already used in the codebase, scaled for bulk.
- On confirm, run `deleteProject(id, user.id)` sequentially for each selected project, surface a single summary toast (`Deleted N · X preserved (letters sent)`) and clear the selection.
- Selection state resets when filters or search change so a hidden row can never be silently included.
- Existing single-row trash icon stays for fast one-off deletes.

### 3. What does "Re-ground" mean? — clarify in-place

`Re-ground` appears on findings whose citation status is `mismatch | not_found | hallucinated | unverified`. It re-invokes the `regroup-citations` edge function for that one finding so the AI tries again to match its `code_reference` against the seeded FBC sections.

The current button shows the word "Re-ground" with a tooltip — but the term is jargon and the tooltip is easy to miss.

**Fix**
- Rename the button label from **"Re-ground"** to **"Recheck citation"** (plain English, action-oriented).
- Keep the tooltip but rewrite it: *"Asks the AI to re-match this finding's code reference against the Florida Building Code library. Use this after you edit the code reference, or when the citation shows as hallucinated, mismatched, or unverified."*
- In the citation status chip directly above the button, add a small `(?)` info icon. Hovering it explains the four states in one sentence each:
  - **Verified** — code matches the FBC section text.
  - **Mismatch** — section exists but its text doesn't support this finding.
  - **Hallucinated** — section doesn't exist in the FBC library.
  - **Unverified** — not yet checked. Click *Recheck citation* to run.
- Apply the same "Recheck citations" rename to the bulk button in `ReviewProvenanceStrip` for consistency.

## Files touched

- `src/pages/ReviewDashboard.tsx` — header rename
- `src/components/review-dashboard/TriageInbox.tsx` — progress label + trimmed hint
- `src/components/review-dashboard/DeficiencyList.tsx` — progress label
- `src/pages/Projects.tsx` — checkbox column, bulk action bar, bulk delete flow
- `src/components/review-dashboard/deficiency/DeficiencyHeader.tsx` — Re-ground rename + tooltip + status info icon
- `src/components/plan-review/ReviewProvenanceStrip.tsx` — bulk button rename

No backend or migration changes required.