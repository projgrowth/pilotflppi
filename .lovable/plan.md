## Audit reconciliation — what shipped vs. what didn't

The original `fpp_audit_report.html` is no longer in the sandbox (uploads are ephemeral), but every claim from it is captured verbatim in `.lovable/plan.md`'s verification table. I cross-checked each against live code.

### Audit findings — final status (21 items)

| ID | Item | Shipped? | Where to verify |
|---|---|---|---|
| C-01 | Mixed AI model families | ✅ | `_shared/ai.ts` default `gemini-2.5-flash`; corrections promoted off `flash-lite` |
| C-02 | Firm name/license hardcoded | ✅ | `ai/index.ts:42-58` `PromptContext` injected |
| C-03 | Pause/resume double-counts | ✅ | `statutory-deadlines.ts:187` `getNetBusinessDaysElapsed` |
| C-04 | No `temperature` on AI calls | ✅ | `_shared/ai.ts:11` required arg, default 0 |
| C-05 | Duplicate `id: "citations"` | ✅ | `letter-readiness.ts:222` renamed to `verifier_completion` |
| C-06 | "FBC 2023" hardcoded | ✅ | `ai/index.ts:52, 95, 106, 150` use `${fbcEdition}` |
| C-07 | `occupant_load` missing from DNA | ✅ | `stages/dna.ts:43, 274` |
| H-01 | Broward `2023-XX` placeholder | ✅ | `data.ts:95` real ordinance ref |
| H-02 | `blockLetterOnUngrounded` ambiguous | ⚠ partial | JSDoc warning added; column rename deferred |
| H-03 | Lovable AI gateway = SPOF | ❌ deferred | No fallback provider |
| H-04 | No concurrent-run guard | ✅ | `run-review-pipeline/index.ts:185` returns 409 |
| H-05 | 14-day resubmission hardcoded | ✅ | `ai/index.ts:53-58` `resubmission_days` from county |
| H-06 | DBPR license verification | ❌ deferred | Documented in README + UI |
| M-01 | False-positive Assembly threshold | ✅ | `threshold-building.ts:55-71` |
| M-02 | Single pause/resume slot | ✅ | `clock_pause_history` JSONB + `buildPausedIntervals` |
| M-03 | No `letter-readiness` tests | ✅ | `src/test/letter-readiness.test.ts` (23 cases) |
| M-04 | Hillsborough mis-classified inland | ✅ | `data.ts:203` `coastal()` |
| M-05 | Correction matching on `flash-lite` | ✅ | both correction edge fns on `gemini-2.5-flash` |
| A-01 | Default README | ✅ | rewritten |
| A-02 | CORS wildcard | ✅ | `ai/index.ts:7-31` allowlist + Vary: Origin |
| A-03 | Cross-firm `firm_settings` leak | ✅ | `index.ts:283-302` firm-scoped lookup |

**Closed: 18. Intentionally deferred: 3 (H-02 column rename, H-03 gateway fallback, H-06 DBPR API).**

### Latent risks the audit didn't catch

These are real issues I found while verifying the audit. Each is small but worth a sweep before calling the review system "production-trustworthy."

1. **`projects.review_clock_paused_at` and `clock_pause_history` can drift.** The legacy column is now a "derived view of the open entry" but nothing enforces that. If two clients race a pause/resume, the column and JSON can disagree and `getStatutoryStatus` will quietly use the wrong one. Fix: a Postgres trigger that keeps the column in sync with the last entry of the JSONB array, or drop the column entirely after a backfill.

2. **DNA `is_coastal` is extracted but no readiness check enforces it.** We added the field and flipped Hillsborough to coastal, but if the AI returns `is_coastal: true` on an inland-classified county, nothing in `letter-readiness.ts` overlays WBDR/flood requirements as the plan promised (plan item 13). The data lands; the logic gate is missing.

3. **`signed_url` lifetime vs. DNA vision call.** `stages/dna.ts:162` uses `signedSheetUrls` then sends URLs to the model. If signed URL TTL is short and the gateway retries, the second attempt may 403. Worth a 60s minimum TTL audit across all vision stages.

4. **Concurrency guard is single-region only.** `H-04` is satisfied at the application layer (`pipeline_already_running`), but with no Postgres advisory lock a true race (two workers within the same millisecond) can still slip through. Plan said "add a Postgres advisory lock on the plan_review_id UUID hash" — that part wasn't implemented. Add `pg_try_advisory_xact_lock(hashtext(plan_review_id))` at the top of the stage runner.

5. **CORS allowlist excludes the Lovable id-preview pattern host.** The regex `/^https:\/\/[a-z0-9-]+\.lovable\.app$/i` matches `pilotflppi.lovable.app` and `id-preview--6396bf6f-...lovable.app`, but the user's custom domain `projgrowth.site` is correctly explicit. Confirm the pattern also matches `*--*.lovable.app` (it does — `-` is in the character class). No fix needed; flagging because the audit's A-02 would have caught a typo here.

6. **Letter readiness gate trusts `reviewer_disposition !== null` to mean "human decided."** A reviewer who saves a draft and walks away can leave a stale disposition that no longer matches the current finding. Consider checking `reviewer_disposition_at >= finding.updated_at` so a finding edited after disposition re-blocks the letter.

### Recommended next moves (ordered)

**Wave 6 — Trust hardening (recommended).** ~1 evening of work. Closes the highest-impact gaps from the latent list.
- Add a DB trigger to keep `review_clock_paused_at` in sync with `clock_pause_history` (risk #1).
- Add an `is_coastal` overlay in `letter-readiness.ts` so inland-classified coastal jobs pick up WBDR/flood requirements (risk #2 — completes plan item 13).
- Add `pg_try_advisory_xact_lock(hashtext(plan_review_id))` at the top of the stage runner (risk #4).
- Stale-disposition check in `letter-readiness.ts` (risk #6).

**Wave 7 — Deferred items (optional, larger).**
- H-02 column rename: coordinated migration of `block_letter_on_ungrounded` → `allow_stub_citations` with value flip + UI sweep.
- H-03 gateway fallback: add a direct-Google AI provider behind a feature flag.
- H-06 DBPR license verification: live API integration; multi-day project on its own.

### What I'd skip

The audit's C-01 model-family complaint is essentially closed by standardizing on `gemini-2.5-flash` and documenting the choice in `mem://logic/ai-intelligence-logic`. Don't churn on it further.

### My recommendation

Approve **Wave 6 — Trust hardening** as the next deploy unit. It's the smallest set of changes that closes every audit-adjacent risk I can verify in the code, and it leaves the three intentionally-deferred items (H-02, H-03, H-06) clearly scoped for their own waves. Reply "yes" to proceed and I'll switch to build mode.
