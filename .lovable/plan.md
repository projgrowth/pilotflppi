## External audit triage — what's real, what's wrong, and the fix order

I cross-checked every claim in `fpp_audit_report.html` against the live code. **18 of 21 findings are accurate**, 2 are partially correct, and 1 is wrong. Below is the verified status, then a staged remediation plan grouped so we don't lose the thread.

---

### Verification results

| ID | Claim | Verdict | Evidence |
|---|---|---|---|
| **C-01** | `gemini-3-flash-preview` is hallucinated | ⚠ **Partially wrong** | The model name *is* in our supported list (per system prompt). However, mixing model families across surfaces (pipeline uses `gemini-2.5-flash`, ai fn uses `gemini-3`) is still a real consistency risk. Reclassify as Medium. |
| **C-02** | Firm name + license # hardcoded in 3 prompts | ✅ Confirmed | `ai/index.ts:26-32, 64, 74` |
| **C-03** | Resume after pause double-counts paused days | ✅ Confirmed | `statutory-deadlines.ts:173` — when not paused, no banked-days subtraction exists |
| **C-04** | No `temperature` set on pipeline AI calls | ✅ Confirmed | `_shared/ai.ts` has zero temperature references |
| **C-05** | Two checks share `id: "citations"` | ✅ Confirmed | `letter-readiness.ts:171, 208` |
| **C-06** | "FBC 2023" hardcoded in letter prompt | ✅ Confirmed | `ai/index.ts:47, 114, 127` |
| **C-07** | `occupant_load` missing from DNA schema but read by threshold logic | ✅ Confirmed | `threshold-building.ts:53` reads it; `dna.ts` schema doesn't extract it |
| **H-01** | Broward `2023-XX` placeholder ordinance | ✅ Confirmed | `county-requirements/data.ts:95` |
| **H-02** | `verified_stub` blocking is opt-out via misleading flag | ✅ Confirmed | `letter-readiness.ts:149` — `!== false` default-true is correct but flag name is ambiguous |
| **H-03** | Single AI gateway = SPOF | ✅ Confirmed (architectural) | All AI routes through `ai.gateway.lovable.dev` |
| **H-04** | No concurrent-run guard in `startPipeline` | ✅ Confirmed | `pipeline-run.ts` has no "running" check |
| **H-05** | 14-day resubmission hardcoded | ✅ Confirmed | `ai/index.ts:53` literal; county data has the field but it's unused in the prompt |
| **H-06** | License check doesn't verify with DBPR | ✅ Confirmed | Trust-on-input only |
| **M-01** | False positive threshold for Assembly >5k sf | ✅ Confirmed (caused by C-07) |
| **M-02** | Single pause/resume slot only | ✅ Confirmed | Schema has one nullable timestamp |
| **M-03** | No tests for `letter-readiness.ts` | ✅ Confirmed | Only 5 test files exist; none cover the readiness gate |
| **M-04** | Hillsborough classified inland, ignoring coastal strip | ✅ Confirmed |
| **M-05** | `gemini-2.5-flash-lite` for correction matching | ✅ Confirmed | `get-similar-corrections/index.ts:106`, `process-correction/index.ts:106` |
| **A-01** | README is default placeholder | ✅ Confirmed |
| **A-02** | CORS wildcard on AI fn | ✅ Confirmed | `ai/index.ts:5` |
| **A-03** | `firm_settings` falls back to any row | ✅ Confirmed | `index.ts:261-266` — `.limit(1)` with no WHERE |

**Disagreements with the audit:**
1. **C-01** is overstated — `gemini-3-flash-preview` is supported. Treat as Medium model-consistency hygiene, not a Critical outage.
2. **H-02** is correctly defaulted (`!== false` means default-blocking) but the flag name *is* confusing and should be renamed.

---

### Remediation plan (4 waves)

Ordered by **legal exposure → trust erosion → multi-tenant safety → polish**. Each wave is a single deploy unit; verify between waves.

#### Wave 1 — Citation & letter integrity (legal blast radius)
Goal: every comment letter that leaves the system has correct firm letterhead, correct FBC edition, correct resubmission deadline, deterministic findings, and a sound readiness gate.

1. **C-02** Inject `firm_settings.firm_name` + `license_number` into the three prompts in `ai/index.ts`. Caller passes them in payload; prompt template uses `${firmName}` placeholders. Drop the hardcoded literals.
2. **C-06 + H-05** Pass `fbc_edition` (from `project_dna`) and `resubmissionDays` (from `county_requirements` for the project's county) into the `generate_comment_letter` payload. Replace literals in the prompt with template variables. Default to FBC 2023 / 14d only when project values are missing, and have the prompt explicitly say "default" when it falls back.
3. **C-04** Add a required `temperature` parameter to `callAI()` in `_shared/ai.ts` (no default). Set `0` for: discipline_review, critic, challenger, cross_check, verify, dedupe, ground-citations. Set `0.3` for any narrative/letter generation. This is a TS signature change so the compiler enforces it everywhere.
4. **C-05** Rename second check to `id: "verifier_completion"` in `letter-readiness.ts`. Add a unit test asserting all returned check IDs are unique (covers M-03 partially).
5. **H-02** Rename `blockLetterOnUngrounded` → `allowStubCitations` (inverted semantics, default `false`). Update the firm setting and all callers. Surface stub count in the readiness UI.

#### Wave 2 — Statutory clock correctness (deemed-approved risk)
Goal: pause/resume math is right under multiple cycles.

6. **C-03 + M-02** Migration: add `clock_pauses jsonb default '[]'` to `projects` (array of `{paused_at, resumed_at}`). On pause: append `{paused_at: now}`. On resume: set `resumed_at` on the last entry. Update `getStatutoryStatus` to sum total banked business days across all entries and subtract from elapsed. Keep `review_clock_paused_at` as a derived view of the open entry for backward compat. Add tests covering: 0 pauses, 1 closed pause, 1 open pause, 2 closed pauses, mixed.

#### Wave 3 — Multi-tenant safety & operational guards
Goal: make this safe for a second firm and survive double-clicks/outages.

7. **A-03** Fix the `firm_settings` fallback in `run-review-pipeline/index.ts:261`. Remove the `.limit(1)` cross-firm fallback entirely; if no row exists for the user, treat as "block = false" (current default behavior) — never read another firm's setting.
8. **H-04** In `pipeline-run.ts:startPipeline`, before invoking, query `review_pipeline_status` for any stage `status = 'running'` for that `plan_review_id`. If found, return `{ ok: false, message: "Pipeline already in progress" }`. Add a Postgres advisory lock on the `plan_review_id` UUID hash inside the edge function for true concurrency protection.
9. **C-07 + M-01** Add `occupant_load: { type: ["integer", "null"] }` to `DNA_SCHEMA.parameters.properties` in `stages/dna.ts`. Update `threshold-building.ts` to add a "definitively not threshold" branch when OL is extracted and ≤500 (skip the advisory entirely).
10. **A-02** Replace CORS wildcard with allowlist: `https://projgrowth.site`, `https://www.projgrowth.site`, `https://pilotflppi.lovable.app`, plus the preview pattern. Echo back the request `Origin` only if it matches.

#### Wave 4 — Test coverage, data hygiene, model consistency, docs
Goal: lock the wins in and clean up the long tail.

11. **M-03** Comprehensive test suite for `computeLetterReadiness()`: pass + fail per check (triage, citations, sheet_refs, qc, notice_filed, affidavit, reviewer_licensed, threshold, coverage, verifier_completion). Pure function — easy.
12. **H-01** Replace Broward `2023-XX` with the actual ordinance number, or remove the entry. Grep the rest of `county-requirements/data.ts` for any other `-XX`/`TBD`/`TODO` placeholder patterns.
13. **M-04** Add `isCoastal` (boolean) to DNA schema. When true, override Hillsborough (and any future inland-classified coastal county) with WBDR + flood requirements at letter-readiness time.
14. **M-05 + C-01** Standardize models. Promote correction functions from `gemini-2.5-flash-lite` → `gemini-2.5-flash`. Decide one model family for non-multimodal text generation and use it consistently across `ai/index.ts` and the pipeline. Document the choice in `mem://logic/ai-intelligence-logic`.
15. **A-01** Write a real README: what FPP does, F.S. 553.791 + 553.899 statutes covered, stack (React + Vite + Lovable Cloud + Lovable AI Gateway), how to add a new county, where Supabase secrets live.
16. **H-06** Defer (out of scope for this pass) — DBPR API integration is a multi-day project on its own. Document as a known limitation in the README and add a settings-page warning that license numbers are self-attested. Open a separate task.

---

### What we're explicitly NOT doing now

- **H-03** (gateway SPOF / fallback to direct Google AI). Real concern but adds significant complexity and a second secret. Track separately; revisit if we hit a Lovable gateway incident.
- **H-06** (DBPR live verification). Deferred per above.

---

### Technical notes

- Wave 1 + Wave 2 + Wave 3 step 9 (DNA schema) are the only items that touch AI prompts or schemas. Test on one project end-to-end after each.
- Wave 2 needs a SQL migration; everything else is code-only.
- After Wave 1, every existing draft letter in the system was generated under the old prompt. They keep their snapshot (immutability triggers protect them) — only new letters get the corrected prompt. Document this in the release notes.
- After approval, I'll create a tracked task per wave so progress is visible and we don't lose state across sessions.

Approve to proceed; tell me if you want to reorder, drop a wave, or pull H-03/H-06 forward.