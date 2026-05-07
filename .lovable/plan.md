
## Why the model hallucinates on residential

I read the pipeline end-to-end (`run-review-pipeline/index.ts`, `discipline-experts.ts`, `stages/discipline-review.ts`, `stages/dna.ts`, `stages/ground-citations.ts`) and queried the seed data. There are five concrete reasons residential reviews invent commercial problems:

1. **No residential persona exists.** Every entry in `DISCIPLINE_EXPERTS` is written for FBC-**Building** commercial work — Architectural's failure modes literally say *"Common path of travel exceeds 75 ft (B occ, sprinklered)"*, Life Safety's persona is *"NFPA 101 + FBC-B Ch.10"*, Accessibility cites FBC Ch.11. For a residential job we currently only:
   - filter Accessibility out of the run list (line 955),
   - prepend a one-line `useTypeLine` hint ("apply FBCR not FBC Building").
   The 200-line commercial system prompt is still sent. That hint loses to the persona every time.

2. **The "mandatory checklist" is 100% commercial.** `discipline_negative_space` has 47 active rows — `0` for residential. Every row cites FBC-B / FBC-A / FBC-EC / NEC. We then instruct the model "audit against this MANDATORY checklist", so it dutifully invents FBC §1006.2.1 common-path findings for a single-family house.

3. **Too many disciplines run.** For a typical SFR we still spin up Architectural, Structural, Energy, MEP, Life Safety, Civil, Landscape, Product Approvals — 8 expert calls × multiple chunks. Most are irrelevant to a 70%-of-portfolio house and each call must "find something" to feel useful, which produces noise.

4. **Citation grounding leans commercial.** `fbc_code_sections` has 504 rows, only 37 residential. When `ground_citations` falls back to the vector-similarity nearest-neighbor (threshold 0.55), it overwhelmingly suggests an FBC-B section, "verifying" a hallucinated commercial citation.

5. **Reviewer memory + jurisdiction context are not use-type scoped.** Learned `correction_patterns` and HVHZ/jurisdiction blocks are injected regardless of use type, so commercial rejections and HVHZ uplift talk leak into residential prompts.

There is also no **per-project scope summary**. The model never sees a sentence like *"This is a new 2-story SFR, ~2,400 sf, no pool, no accessory structure"* — it just sees raw sheets and a generic checklist, so it free-associates.

## What we will build

A "Residential mode" that is the default path for `projects.use_type = 'residential'` and that strips back everything not anchored to **FBC Residential 8th Edition (2023) — codes.iccsafe.org/content/FLRC2023P2**.

### 1. Residential personas + failure modes (`discipline-experts.ts`)

Add a parallel `RESIDENTIAL_DISCIPLINE_EXPERTS` table keyed to the disciplines that actually apply to FBCR work:

- `Residential Building` — FBCR Ch. 3 (building planning), 4 (foundations), 5 (floors), 6 (walls), 7 (wall covering), 8 (roof-ceiling), 9 (roof assemblies), 10 (chimneys), 11 (energy efficiency).
- `Residential Structural` — FBCR Ch. 3 R301 (loads, wind), R401-R407 (foundations), R602 (wood walls), R802 (rafters/trusses), HVHZ R4404.
- `Residential MEP` — FBCR Ch. 12-24 (mechanical, fuel gas), Ch. 25-32 (plumbing), Ch. 33-43 (electrical), referencing NEC where adopted.
- `Residential Energy` — FBCR Ch. 11 / FBC-EC Residential provisions (climate zone 1/2 path, RESCheck/Form R405).
- `Product Approvals` — keep, but trimmed to windows/doors/roofing/garage doors with FL# (NOA only when HVHZ).

Each persona will:
- Open with *"FBC Residential 8th Edition (2023) is the controlling code. FBC-Building, NFPA 101, and FBC Ch.11 do NOT apply unless the cover sheet declares a use beyond R-3."*
- List failure modes drawn from FBCR (e.g. *"R310 EERO not provided in basement / habitable attic"*, *"R602.10 braced wall lines not designated"*, *"R301.2.1 wind design not shown"*, *"R703 weather-resistive barrier not specified"*).
- End with the existing SHARED_RULES block.

`composeDisciplineSystemPrompt(discipline, { useType })` will pick the residential or commercial table based on `useType` rather than always pulling from the commercial table.

### 2. Residential checklist seed (`discipline_negative_space`)

Add ~40 active rows with `use_type = 'residential'` covering at minimum:

- R301 wind design parameters declared on cover/structural notes
- R302 fire separation (townhouse / garage to dwelling)
- R310 emergency escape & rescue openings
- R311 means of egress (stairs, halls, doors)
- R312 guards & R313 sprinklers (if townhouse)
- R314 smoke alarms / R315 CO alarms
- R316 foam plastic insulation
- R401-R407 foundation
- R602.10 braced wall lines + R602.11 anchorage
- R703 exterior wall covering / WRB
- R802 rafters/trusses & R806 attic ventilation
- R903 roof drainage / R905 roof coverings (with FL#/NOA)
- R1001 chimneys / R1002 fireplaces
- N1101+ energy provisions (envelope, mechanical, lighting paths)
- Plumbing Ch.25-32 (water heater PRV, backflow, fixture rough-in)
- Electrical Ch.34-43 (service size, AFCI/GFCI, panel sched, smoke/CO power)

Schema change: add `use_type text` column to `discipline_negative_space` and update the `runDisciplineChecks` query to `.eq('use_type', useType)` (treat null as "applies to both" for back-compat).

### 3. Cover-sheet scope extractor (new mini-stage)

Right after `dna_extract`, call a small `scope_summary` extractor on the cover/index sheet only. It outputs a short JSON blob the rest of the pipeline injects verbatim:

```text
{
  building_type: "single_family_detached" | "townhouse" | "duplex" | "addition" | "renovation",
  stories: 1,
  conditioned_sf: 2380,
  has_garage: true,
  has_pool: false,
  has_accessory_structure: false,
  hvhz: false,
  scope_notes: "New 2-story SFR on slab, attached 2-car garage, asphalt shingle roof"
}
```

This is prepended to every discipline prompt as the **PROJECT SCOPE** section. The model is told: *"Only raise findings that are clearly within this scope. Do NOT invent components (pool, elevator, sprinkler riser, etc.) that are not listed here."*

### 4. Discipline trim for residential

In `discipline-review.ts` line 955, replace the current filter with:

```text
useType === "residential"
  ? ["Residential Building", "Residential Structural", "Residential MEP",
     "Residential Energy", "Product Approvals"]
  : DISCIPLINES
```

Drop `Life Safety`, `Civil`, `Landscape`, and `Accessibility` for residential by default. Civil/Landscape only get re-enabled if the scope summary shows a separate site-civil sheet set.

### 5. Use-type-aware grounding + reviewer memory

- `ground_citations`: when `useType === 'residential'`, filter `match_fbc_code_sections` to rows whose `code` is `FBCR` or whose `section` matches `^R\d` / `^N11\d` / `^M\d`/`^P\d`/`^E\d`. Vector fallback that returns a non-residential hit becomes `mismatch` instead of `verified`.
- Backfill `fbc_code_sections` with the FBCR 8th-edition table of contents (chapter + section + title) from `codes.iccsafe.org/content/FLRC2023P2` so verification has something to land on. Bodies can be stubs initially — the existence check is what matters.
- `correction_patterns` query in `discipline-review.ts` adds `.eq('use_type', useType)` so commercial rejections don't pollute residential prompts.

### 6. Strip cross-cutting noise

For residential, also disable in this pass:

- `submittal_check` already skips (good). Also skip `cross_check`, `deferred_scope`, `challenger`, `callout_graph` for residential — they're tuned for multi-trade commercial sets and add latency without useful findings.
- Remove the HVHZ/jurisdiction prose block from prompts when `dna.hvhz === false`.
- Self-critique pass (`runDisciplineChecks` SELF_CRITIQUE) stays — it actually fights hallucination — but its prompt gets the same RESIDENTIAL persona.

### 7. Final checklist sweep (your "reference back to checklist at end of day")

After all discipline calls finish, run a deterministic sweep that takes the ordered residential checklist (#2 above) and the union of all findings. For each checklist item with no matching finding, insert a low-priority "Verify on plan: <item>" finding tagged `requires_human_review=true`. This guarantees a human sees every checklist item even if AI missed it, without the AI fabricating a deficient quote.

## Technical details

- Files: `supabase/functions/run-review-pipeline/discipline-experts.ts`, `stages/discipline-review.ts`, `stages/dna.ts`, `stages/ground-citations.ts`, `_shared/types.ts` (add residential disciplines + `stagesForResidential` chain), and a new `stages/scope-summary.ts`.
- Migrations: add `use_type text` to `discipline_negative_space` and seed FBCR rows; backfill FBCR section index in `fbc_code_sections`.
- Model: keep `google/gemini-2.5-flash` for cost; the wins come from prompt scoping, not a bigger model.
- Backward compatibility: commercial flow is unchanged — all changes branch on `projects.use_type === 'residential'`.

## Out of scope for this pass

- AI learning loop changes beyond the use-type filter
- UI changes to plan review (separate task)
- Importing full FBCR body text — we seed titles/sections only; full text comes later

I'll implement in this order on approval: residential personas → checklist seed + schema column → scope-summary stage → discipline trim + memory filter → grounding filter + FBCR section seed → final checklist sweep.
