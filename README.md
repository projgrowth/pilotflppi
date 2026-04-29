# Florida Private Provider (FPP) Platform

An AI-assisted plan-review and inspection platform for Florida private providers
operating under **F.S. 553.791** (Alternative Plans Review and Inspections) and
**F.S. 553.899** (milestone / recertification inspections).

The system ingests sealed construction documents, extracts the project's
"DNA" (occupancy, construction type, jurisdiction, code edition, threshold
flags), runs a multi-stage AI review against the Florida Building Code and
local amendments, and produces:

- A defensible **comment letter** with grounded FBC citations and per-finding
  evidence crops.
- A **statutory deadline tracker** that respects the 30-day plan-review and
  10-day inspection clocks under F.S. 553.791, including paused-clock math
  for resubmittal cycles.
- The **Notice to Building Official**, **Plan Compliance Affidavit**, and
  **Certificate of Compliance** documents required by statute.
- A **letter readiness gate** that blocks send when statutory or evidentiary
  prerequisites are missing (citations ungrounded, sheets unmapped,
  reviewer license missing for a discipline, etc.).

## Statutes covered

- **F.S. 553.791** — Private provider plan review + inspection program
  - 553.791(2): Reviewer license requirements (gated in app)
  - 553.791(4)(a): Notice to Building Official prerequisite
  - 553.791(7)(b): Plan Compliance Affidavit per submittal
- **F.S. 553.79(5)** — Threshold building Special Inspector designation
- **F.S. 553.899** — Milestone and 25/40-year recertification inspections

## Stack

- **Frontend**: React 18 + Vite 5 + TypeScript + Tailwind (semantic tokens
  in `src/index.css`).
- **Backend**: Lovable Cloud (managed Supabase). Postgres + Storage + Auth.
- **AI**: Lovable AI Gateway. The text pipeline standardizes on
  `google/gemini-2.5-flash` (deterministic for compliance work,
  `temperature: 0` enforced in `_shared/ai.ts`). Vision/extraction stages
  use `google/gemini-2.5-pro`.
- **Tests**: Vitest + Testing Library.

## Project layout

```
src/
  components/             UI (organized by feature folder)
  hooks/plan-review/      Page-scoped data + side-effect hooks
  lib/
    letter-readiness.ts   Pure send-gate calculator (covered by tests)
    statutory-deadlines.ts F.S. 553.791 clock math (incl. pause history)
    threshold-building.ts  F.S. 553.79(5) classifier
    county-requirements/   Per-county rules (HVHZ, NOA, wind speed, etc.)
  test/                   Vitest suite (deadline, readiness, grid, etc.)
supabase/functions/
  ai/                     User-facing one-shot AI actions (letter, etc.)
  run-review-pipeline/    Multi-stage review pipeline (DNA → discipline →
                          critic → cross-check → verify → ground citations)
```

## Adding a new county

County-specific rules live in `src/lib/county-requirements/data.ts` as the
`COUNTY_REGISTRY`. Each entry overrides `DEFAULT_REQUIREMENTS` for the parts
that differ. Use the `inland(...)` and `coastal(...)` helpers at the top of
the file for the common shapes; override specifics inline. The county key is
the lowercase, hyphenated county name (e.g. `palm-beach`).

Required fields when adding:

- `key`, `label`
- `designWindSpeed` (string with ASCE reference)
- `buildingDepartment` (name + address)
- `productApprovalFormat` (`"FL#"` or `"NOA"`)
- `windBorneDebrisRegion`, `floodZoneRequired` booleans
- `resubmissionDays` (calendar days the AHJ allows for resubmittal — used
  by the comment-letter prompt)
- `amendments` (cite real ordinance numbers, not placeholders)

The county is then automatically resolved by `getCountyRequirements()` and
threaded into the AI letter prompt and statutory clock.

## Secrets

Backend secrets are managed in Lovable Cloud (Connectors → Lovable Cloud →
Settings). Required:

- `LOVABLE_API_KEY` — provisioned automatically for the AI gateway.
- `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` —
  provisioned automatically.

No third-party API keys are required for the AI pipeline; everything routes
through Lovable AI Gateway.

## Known limitations

- **Reviewer license verification is self-attested.** The platform gates the
  letter on whether the signing reviewer has a license number on file for
  each discipline appearing in the letter, but does not currently call the
  Florida DBPR API to verify the license is active and unrestricted. Treat
  the license fields as a chain-of-custody record, not a real-time check.
  (Tracked separately; see audit finding H-06.)
- AI gateway is a single dependency. If Lovable AI Gateway has an outage,
  pipeline kickoff returns an error and the reviewer must retry once the
  gateway recovers; there is no automatic fallback to a second provider.

## Tests

```bash
bunx vitest run
```

Key suites:

- `src/test/deadline.test.ts` — statutory clock, pause/resume math.
- `src/test/letter-readiness.test.ts` — send-gate calculator (every check).
- `src/test/finding-status.test.ts`, `grid.test.ts`, `round-diff.test.ts`.
