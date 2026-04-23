

# Next Best Improvements — Quality, Trust & Throughput

The P0/P1 fixes from the last audit shipped. The system is now stable enough that the next gains come from **what reviewers actually do with it** and **how well the AI gets out of their way**. The data tells the story:

```text
85 v2 findings produced → only 1 confirmed, 15 rejected, 69 untouched (81%!)
27 findings flagged "requires_human_review" — same UI as the rest, no priority cue
8 correction patterns captured, 0 confirmations recorded → reliability score is
   one-sided: the AI only learns it was wrong, never that it was right
Pipeline: still 4-7 errors per stage in the last 7 days (sheet_map, dedupe,
   discipline_review the worst). New retry helper helps but errors aren't
   surfaced anywhere a human will see them.
```

So the next round is three themes: **trust the output faster**, **close the learning loop**, and **see when something breaks**.

---

## 1. Triage that actually moves findings (biggest win)

Right now the dashboard shows all 85 findings as a flat list. A reviewer has to read each one to decide what to do — there's no "start here" surface. Result: 81% untouched.

**Build a Triage Inbox view** as the default landing tab on `ReviewDashboard`:

- **Priority queue ordering** — sort by: `requires_human_review` first, then `life_safety_flag`, then `permit_blocker`, then `confidence_score < 0.7`, then everything else. The 27 review-required items rise to the top.
- **Keyboard-first triage** — `J/K` to move, `C` confirm, `R` reject (opens existing dialog), `M` modify, `S` skip. Already have `TriageShortcutsOverlay` — wire it into a real loop with focus management on a single "active" card.
- **One-keypress confirm** — currently confirm needs a click + the optimistic update is silent. Add a brief inline checkmark animation + auto-advance to next card. The path from "AI surfaced this" to "reviewer agreed" should be ≤1 second.
- **Bulk-confirm by sheet** — for sheets where ALL findings are >0.85 confidence and not flagged, a single "Confirm all 6 on A-101" button. Most reviewers trust the AI on routine items per-sheet.

Files: new `src/components/review-dashboard/TriageInbox.tsx`, extend `useTriageController.ts`, surface as default tab in `ReviewDashboard.tsx`.

## 2. Close the learning loop — confirmations must count

`recordPatternConfirmation` exists in `DeficiencyActions.tsx` but the DB shows `confirm_count = 0` across all 8 patterns. Either it's silently failing (`.catch(() => {})` swallows it) or the matching logic isn't finding patterns to credit. Either way, **today the AI only ever learns it was wrong** — reliability score drifts down monotonically, eventually pruning patterns the reviewer actually agreed with.

Concrete actions:

- **Diagnose & fix `recordPatternConfirmation`** — replace the silent catch with a non-blocking toast + a row in a new `pattern_match_log` (or just `console.error` to Edge logs) so we can see why matches miss. Likely cause: discipline-name normalization mismatch (DB has "MEP" vs AI emits "Mechanical").
- **Add `confirm_count` to the reliability score formula** — currently the prompt-injection picks patterns by `rejection_count DESC`. Switch to `(rejection_count - confirm_count) DESC, last_seen_at DESC` so a pattern reviewers later agreed with stops being injected as a warning.
- **Surface "Reviewer Memory" in the dashboard** — small card on `ReviewDashboard` showing the top 3 active patterns the AI is currently trained on for this jurisdiction/discipline, with a "Disable" button. Trust comes from being able to see what the model has been told.
- **Show pattern matches per finding** — when a finding is generated and a correction pattern fired during prompting, add a small "🧠 Trained on 3 prior rejections" badge on the deficiency card linking to the pattern.

Files: `src/hooks/useCorrectionPatterns.ts`, `src/components/review-dashboard/ReviewerMemoryCard.tsx` (already exists — wire it in), `supabase/functions/run-review-pipeline/stages/discipline-review.ts` (or current location of pattern injection).

## 3. Pipeline observability — errors users can see and act on

The new retry helper masks transient errors but **stage-level failures still die silently** in `review_pipeline_status.error_message`. The Pipeline Activity page lists active runs but doesn't show *what failed and why*. 4-7 hard errors per stage in 7 days is too many to ignore.

- **Add an "Errors" tab to `PipelineActivity`** — last 24h of `status='error'` rows, with the truncated `error_message`, stage, retry count, and a **Retry from this stage** button (re-uses `resumePipelineForReview` we already updated).
- **Stage-level error toasts on the detail page** — when realtime fires an `error` status for the currently-open review, show a toast with the stage name + Retry CTA. Right now you have to refresh to know.
- **Lightweight error telemetry** — add a `pipeline_error_log` table written from the edge function on final failure (post-retries) with `{ stage, error_message, error_class, planReviewId, attempt_count }`. Then a simple `/admin/health` route reads it and groups by `error_class` so you can see "AI gateway 429: 12 occurrences this week" at a glance.

Files: `src/pages/PipelineActivity.tsx`, `src/hooks/usePlanReviewData.ts` (subscribe to status errors), one new migration for `pipeline_error_log`.

## 4. Accuracy: stop the AI manufacturing findings on irrelevant sheets

Spot-checking the 15 rejections: most are on the wrong discipline for the sheet (e.g., "structural" finding on an electrical sheet because both disciplines reviewed every sheet). The pipeline already has `sheet_coverage` with discipline tags — use it.

- **Hard-filter sheet inputs per discipline call** — when running the Mechanical expert, only pass sheet images tagged `discipline IN ('Mechanical','MEP','General')`. Today the prompt says "ignore sheets outside your scope" but the AI gets shown all of them anyway, which is expensive and noisy.
- **Confidence floor by discipline** — drop any finding with confidence <0.55 on a sheet not assigned to its discipline. Tiny addition in `stageDedupe`.

Files: `supabase/functions/run-review-pipeline/index.ts` lines ~1430-1522 (`runDisciplineChecks`), and the dedupe stage.

## 5. Smaller polish (parallel-safe)

- **Drop legacy PNG render path in `pdf-utils.ts`** (still ~140 lines of dead-ish code; only `usePdfPageRender` and `ZoningAnalysisPanel` use it — both safe to migrate to JPEG/streaming). Carryover from last audit.
- **`PlanReviewDetail.tsx` still has 20 `useState`s** — extract the filter group (`statusFilter`, `confidenceFilter`, `disciplineFilter`, `sheetFilter`) into a single reducer + serialize to URL search params so reload preserves the view.
- **`as any` cleanup** — 36 occurrences. Knock out the 9 in the edge function with the small typed `PipelineRow` interface noted last time; the others are mostly Supabase type cast workarounds that can wait.

---

## Suggested execution order

1. **Triage Inbox + keyboard loop** — biggest UX delta, no schema changes. (~1 commit)
2. **Pattern confirmation fix + Reviewer Memory card** — restores the learning loop. (~1 commit, no schema)
3. **Pipeline error visibility** — small migration, big trust win. (~1 commit + migration)
4. **Discipline-scoped sheet filtering** — improves precision, cuts AI cost. (edge function only)
5. **PNG render path removal + URL filter state** — cleanup, no behavior change.

No edge function contract changes. One small migration (`pipeline_error_log`). All changes are additive — nothing existing breaks.

