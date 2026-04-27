

# Two plans, one approval

## A. Strip to "Plan Review only" (now)
## B. Tighten review legitimacy + pipeline (after the strip)

You can approve both, A only, or B only.

---

# A · Strip the app to plan-review core

The sidebar has 12 destinations. Only ~4 are load-bearing for the review-and-issue-comments loop. Everything else is splitting attention and adding maintenance.

## What stays (the workflow)

```text
Dashboard         — landing, "what needs me" queue
Projects          — list + create new review
Plan Review       — list of reviews
Pipeline Activity — the live stepper / debug surface (you depend on this)
Settings          — firm settings, jurisdictions live as a tab here
```

Plus the deep pages that already work:
- `/plan-review/:id` (the actual review work surface)
- `/plan-review/:id/dashboard` (the review dashboard / triage)

## What gets parked (route stays, sidebar entry removed)

Hide from sidebar but keep the page mounted so existing links/bookmarks still resolve. Behind a `VITE_FEATURE_EXTRAS` flag we flip to `true` later when you want them back.

```text
Inspections      → hidden
Documents        → hidden
Invoices         → hidden
Deficiencies     → hidden  (it's a library, not a daily destination)
Contractors      → hidden
Analytics        → hidden
Lead Radar       → hidden
Milestone Radar  → hidden
Jurisdictions    → moved into Settings as a tab
```

Bottom mobile tab bar shrinks from 5 → 3: **Dashboard · Review · Menu**.

## What gets deleted (truly dead weight)

After grepping links, these are unreferenced or only reachable from the hidden sidebar — safe to remove the route + page later, but in this pass we keep them mounted to avoid breaking anything. One follow-up cleanup PR.

## Dashboard rewrite

Today's `/dashboard` has deadline rings, statutory clocks, fee widgets, lead radar shortcuts. Replace with a **single "Active Reviews" board**:

```text
┌──────────────────────────────────────────────────┐
│  ACTIVE REVIEWS (3)                  + New       │
├──────────────────────────────────────────────────┤
│  ▣ Pizza Restaurant       ── stuck at sheet_map  │
│      ⓘ 2 min idle · resume                       │
├──────────────────────────────────────────────────┤
│  ▣ SUNCOAST PORSCHE       ── ready for letter    │
│      47 findings · open                          │
├──────────────────────────────────────────────────┤
│  ▣ Site Plan              ── needs preparation   │
│      open                                        │
└──────────────────────────────────────────────────┘

NEEDS MY REVIEW (7)                       view all
─ findings flagged for human review across reviews
```

That's the entire page. Statutory clocks, fees, etc. survive at the project detail level. The dashboard becomes "what should I touch in the next hour".

## Files

```text
EDIT  src/components/AppSidebar.tsx          ── trim mainNav + bottomTabs
EDIT  src/pages/Dashboard.tsx                ── rewrite around active reviews
EDIT  src/pages/Settings.tsx                 ── add Jurisdictions tab
EDIT  src/App.tsx                            ── routes stay; no removal
NEW   src/lib/feature-flags.ts               ── single VITE_FEATURE_EXTRAS gate
```

No DB changes, no backend changes. Reversible in one commit.

---

# B · Plan-review legitimacy + pipeline improvements

This is where the app earns trust. A reviewer signing a comment letter needs to know **every finding is grounded**. Today the pipeline can ship findings whose citations were never matched against `fbc_code_sections`.

## 1. Don't surface ungrounded findings as "verified"

Today `deficiencies_v2.citation_status` defaults to `'unverified'` and only flips to `'grounded'` after the (deep-pass-only) `ground_citations` stage runs. Core pipeline never grounds. Result: reviewer sees a finding with `FBC 1011.5.4` cited and no signal that the citation was never validated.

**Fix:** in `FindingCard` / `DeficiencyCard`, render an explicit badge:
- `citation_status='grounded'` and `match_score >= 0.8` → green "Verified citation"
- otherwise → amber "Citation unverified — review before sending"

And gate the Comment Letter "Send" / "Export" button: if any included finding is unverified, require an explicit checkbox *"I've verified the citations on these N findings"*. No more silent shipping.

## 2. Make grounding part of CORE, not deep-only

Move `ground_citations` from `DEEP_STAGES` into `CORE_STAGES`, immediately after `dedupe`:

```text
CORE_STAGES (new):
  upload → prepare_pages → sheet_map → dna_extract
  → discipline_review → dedupe → ground_citations → complete
```

Cost: one extra cheap embedding/compare pass per finding. Benefit: every finding shipped from a default run has a real citation match score. Today's "deep" mode becomes **verify + cross_check + deferred_scope + prioritize** — the truly optional QA passes.

## 3. Sheet-coverage gate before discipline review starts

`sheet_map` produces `sheet_coverage` per discipline. If a discipline has zero mapped sheets we still spawn a discipline-review chunk and the AI hallucinates findings against thin air. Add a precondition:

```ts
// before launching discipline_review for a discipline:
if (sheetsForDiscipline(d).length === 0) {
  recordSkip(d, "no sheets mapped for this discipline");
  continue;
}
```

The skipped discipline shows on the dashboard as "Not reviewed — no sheets" with a one-click "Force review anyway" override. Honest > complete.

## 4. Confidence floor + "low confidence" bucket

`deficiencies_v2.confidence_score` exists but isn't used in the UI ranking. Two changes:

- Hide findings with `confidence_score < 0.4` from the default list. Show a "12 low-confidence findings hidden — review" expander.
- Sort the rest descending by `confidence_score` within each severity tier.

Stops bottom-of-the-barrel guesses dominating the inbox.

## 5. Round-over-round carryover requires reviewer confirmation

`previous_findings` is already tracked. Today on round 2 the AI re-finds the same things and we dedupe. Better: on starting round N, present "**Carry-over: 14 findings unresolved from round N-1 — confirm before re-running**". Reviewer ticks which ones to keep watching. Round N pipeline knows to focus there. Cuts AI cost, kills duplicate findings, and is the reviewer's actual mental model.

## 6. Pipeline observability the reviewer can trust

Two small surface changes:

- Every finding card shows a tiny footer: `sheet_map · discipline_review (Architectural) · dedupe · ground_citations` — the chain that produced it. Click → opens the relevant `pipeline_error_log` rows. Already 90-day retained.
- Pipeline Activity gets a "Health" column per active run: `% findings grounded · % low-confidence · % requires_human_review`. If a run lands at "0% grounded, 80% low confidence" the reviewer sees that **before** opening it.

## 7. Lock the model + prompt version per finding

`deficiencies_v2` already has `model_version` and `prompt_version_id`. Today they get filled but aren't shown. Add to the finding's expand-detail view: "Generated by `gemini-2.5-pro` · prompt v3 · 2026-04-23 19:30". When you change a prompt next quarter and a reviewer asks "why did the same plan suddenly find 12 more things?" you have the answer.

## Files

```text
EDIT  supabase/functions/run-review-pipeline/index.ts
        ── ground_citations into CORE_STAGES
        ── sheet-coverage precondition for discipline_review
        ── emit chain metadata per finding
EDIT  src/lib/pipeline-stages.ts                ── mirror CORE_STAGES change
EDIT  src/components/FindingCard.tsx
        ── citation badge, confidence sort, chain footer, model footer
EDIT  src/components/CommentLetterExport.tsx    ── unverified-citation gate
EDIT  src/components/plan-review/RoundCarryoverPanel.tsx
        ── reviewer-confirms-carryover before round N pipeline
EDIT  src/pages/PipelineActivity.tsx            ── per-run Health column
NEW   src/components/plan-review/CitationStatusBadge.tsx
```

No new tables. All columns exist already. Reversible per file.

---

# Recommended path

Ship **A** today (one-day change, immediate clarity). Then **B** in the same week — those are the changes that turn this from "AI-assisted draft" into "a reviewer can sign their name to it". The hidden routes from A re-light when you flip the env flag once invoices/CRM matter again.

