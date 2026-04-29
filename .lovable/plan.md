# Make AI auto-fill visible during New Plan Review

## Problem

When you drop PDFs into "New Plan Review", the AI runs in the background to extract project name, address, county, etc. from the title block. This can take up to ~20 seconds, but the only visible signal is a tiny `Sparkles` icon and the text "AI auto-filling…" wedged into the file-count line at the bottom of the file list. There's no indication on the form fields themselves that they're about to be populated, no progress, and no estimate of how long it will take. Users assume the dialog is frozen and either wait confused or start typing manually (which then blocks the AI from filling those fields).

A second smaller issue: after clicking "Start review", the button shows a spinner labeled "Starting…" but the helper text below ("We'll keep uploading in the workspace — keep this browser open for ~30 sec") is small and easy to miss.

## What we'll change

All changes are in `src/components/NewReviewDialog.tsx`. No backend/API changes.

### 1. Prominent auto-fill banner

When `extracting === true`, show a full-width banner directly under the drop zone (above the form fields) instead of the tiny inline hint:

```
┌──────────────────────────────────────────────────────────┐
│ ✦ Reading your plans…                                    │
│   AI is extracting the project name, address, county     │
│   and trade from the title block. Usually 5–15 seconds.  │
│   ▓▓▓▓▓▓▓▓░░░░░░░░░░░░  (animated indeterminate bar)    │
└──────────────────────────────────────────────────────────┘
```

- Uses the existing accent color, `Sparkles` icon, and a Tailwind animated progress bar (no new deps).
- After completion, briefly transitions to a green "✓ Auto-filled N field(s)" confirmation that fades out after ~3s (we already toast this — we'll keep both, but the banner makes it impossible to miss).

### 2. Per-field "AI is filling this…" affordance

While `extracting` is true, on the empty fields that AI will populate (Project Name, Address, County, Trade), show a faint shimmer/pulse on the input border and a small `Sparkles` icon inside the input on the right side. The moment a field is filled (or the user types in it), the affordance disappears for that field. This gives a visual link between "AI is working" and the specific fields it's about to touch.

### 3. Don't reset extraction state silently on timeout

Today, on the 20s timeout the `catch` block is silent. We'll add a soft toast: "Auto-fill timed out — please fill the fields manually" so users know to take over. The form is otherwise unaffected.

### 4. Clearer submit/handoff state

Replace the small helper text under the "Start review" button with a more prominent inline status block that appears only while `saving` is true:

```
┌──────────────────────────────────────────────────────────┐
│ ⟳ Creating review and uploading {N} file(s)…             │
│   You'll be taken to the workspace in a moment. Keep     │
│   this tab open for ~30 seconds while uploads finish.    │
└──────────────────────────────────────────────────────────┘
```

The button itself stays disabled with the existing "Starting…" spinner.

### 5. Disable form interaction during extraction? (No)

We considered disabling the form during extraction so users wait for AI, but the current "user can submit immediately, AI fills empty fields only" behavior is good. We'll keep it. The new banner just makes the wait *visible* rather than hidden.

## Files touched

- `src/components/NewReviewDialog.tsx` — banner, per-field affordance, timeout toast, submit status block.

No new packages, no backend changes, no migrations. Nothing else in the app is affected.
