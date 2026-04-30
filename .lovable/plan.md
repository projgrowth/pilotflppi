
# Phase 0 Foundations + Wave E Slice 1: FEMA & ASCE External Data

This ships the reusable infrastructure every later wave (defense briefs, calibration, two-reviewer gate, applicant portal, inspections-parity, AHJ portals) will depend on, plus the first concrete external-data integration that proves the pattern: pulling **FEMA flood zone** and **ASCE 7 design wind speed** from the project address and surfacing them to the reviewer (and, once trusted, to the AI critic).

Zero changes to existing pipeline behavior. Everything new is gated behind a per-firm feature flag and shipped in side tables.

---

## What ships

### A. Foundations (used by every future wave)

1. **Per-firm feature flags table** — runtime toggles, no rebuild required.
2. **`external_data_snapshots` table** — append-only cache of every external lookup, keyed by `(plan_review_id, source)`, with a 30-day TTL. Snapshots are what the pipeline reads; the network call is decoupled from the AI run, so re-runs are deterministic and audits are free.
3. **`useFeatureFlag(flag)` hook** — reads `firm_settings.feature_flags` jsonb (one column added; no new RLS surface).

### B. FEMA flood zone lookup

- Edge function `fetch-fema-flood` — calls FEMA's public NFHL ArcGIS REST endpoint (no key needed) with a geocoded lat/lng, returns `{ flood_zone, bfe_ft, firm_panel, effective_date }`, writes a snapshot.

### C. ASCE 7 design wind speed lookup

- Edge function `fetch-asce-hazard` — calls the public ATC Hazards-by-Location API (no key needed) for `{ wind_speed_mph_riskII, wind_speed_mph_riskIII, exposure_default, lat, lng }`, writes a snapshot.

### D. Reviewer-visible UI (no AI behavior change yet)

- New right-rail tab **"Site Data"** on `PlanReviewDetail` (sits alongside existing Plan Viewer / Findings / Letter tabs).
- Component `ExternalDataPanel.tsx` — shows FEMA + ASCE values, fetched/expires timestamps, "Refresh" button (admin only), and a "Copy to clipboard" for paste-into-letter.
- Empty state when feature flag off or address missing.

### E. Settings surface

- New row in **Settings → Firm** for "Beta features" with a toggle for `external_data_v1`.

---

## What does NOT ship in this phase (deferred — kept clean)

- Pipeline cross-checking findings against FEMA/ASCE (Phase 1 next).
- Local amendments table.
- Florida Product Approval lookup.
- AHJ submittal checklists.
- Defense briefs, signatures, calibration, two-reviewer gate.

Keeping this slice tight ensures the foundation tables and edge-function pattern bake before we layer pipeline coupling on top.

---

## File / table changes

### New tables (one migration)

```text
public.external_data_snapshots
  id uuid PK, plan_review_id uuid NOT NULL,
  firm_id uuid (auto via trigger),
  source text NOT NULL,          -- 'fema_flood' | 'asce_hazard'
  payload jsonb NOT NULL,
  fetched_at timestamptz default now(),
  expires_at timestamptz,
  fetched_by uuid,
  UNIQUE (plan_review_id, source)  -- upsert on refresh
RLS: firm-scoped read/insert/update via user_firm_id(auth.uid()), admin override.
Trigger: set_firm_id_from_plan_review (existing function — reused).
```

### New column

```text
public.firm_settings
  + feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb
```

### New files

```text
supabase/functions/fetch-fema-flood/index.ts
supabase/functions/fetch-asce-hazard/index.ts
src/lib/sources/fema-flood.ts          # client adapter (invoke + cache read)
src/lib/sources/asce-hazard.ts
src/lib/sources/types.ts               # shared FemaSnapshot / AsceSnapshot types
src/hooks/useExternalData.ts           # react-query wrapper, reads snapshot row
src/hooks/useFeatureFlag.ts
src/components/plan-review/ExternalDataPanel.tsx
src/components/settings/BetaFeaturesCard.tsx
```

### Touched files (additive only — no logic edits to existing flows)

```text
src/components/plan-review/RightPanelTabs.tsx   # add "Site Data" tab when flag on
src/pages/PlanReviewDetail.tsx                  # mount ExternalDataPanel
src/pages/Settings.tsx                          # mount BetaFeaturesCard
```

No edits to `useReviewDashboard`, `letter-readiness`, the pipeline stages, or any AI prompt. The only existing-file diffs are tab registration and settings rendering.

---

## Technical details

**Edge function pattern (both FEMA and ASCE):**
- `verify_jwt` defaults; validate auth via `getClaims()`.
- Zod-validate `{ plan_review_id: uuid, lat: number, lng: number, force?: boolean }`.
- If `!force` and a snapshot exists with `expires_at > now()`, return the snapshot (no upstream call).
- Otherwise fetch upstream, parse, upsert into `external_data_snapshots` with `expires_at = now() + 30 days`, return.
- All upstream calls wrapped in `try/catch` with a 10s timeout; failures return `{ ok: false, reason }` and do NOT write a snapshot (so a transient outage doesn't poison the cache).

**Geocoding:** Reuse existing `src/lib/geocode.ts`. If the project has no lat/lng yet, the panel shows "Add address to enable site data" and links to project edit.

**Auth in panel:** The Refresh button only renders for users with `admin` role (already exposed by `useIsAdmin`). Reviewers see the data, only admins force-refresh.

**Performance:** Snapshots cached 30 days; client uses react-query with `staleTime: 5min`. No polling.

**Cost:** Both upstream APIs are free, public, unauthenticated.

---

## Acceptance criteria

1. Migration runs cleanly; `supabase--linter` reports no new findings.
2. With flag OFF, the app renders identically to today (no new tab, no new settings card visible — card itself is visible to admins to flip the flag).
3. With flag ON and a project address present, opening a plan review shows the Site Data tab with FEMA + ASCE values within ~3s on first load, instant on subsequent loads.
4. Refresh button (admin only) bypasses cache and updates `fetched_at`.
5. Two firms cannot read each other's snapshots (RLS verified by test in `src/test/`).
6. Existing plan reviews are untouched; existing letters and findings unchanged.

---

## Why this slice first

- **Zero risk to the existing pipeline** — pure additive read surface.
- **Proves the snapshot + feature-flag pattern** that every later wave reuses.
- **Immediate reviewer value** — wind speed and flood zone are referenced in nearly every Florida structural and envelope finding; having them one click away saves real time today, before any AI coupling.
- **Sets up Phase 1** (pipeline cross-check against FEMA/ASCE) as a small, focused follow-up rather than a megaprompt change.

Approve and I'll implement, then propose Phase 1 (pipeline coupling) as the next plan.
