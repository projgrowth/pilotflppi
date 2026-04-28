# Next best improvement: Execute Sprint 4 — Inspections Compliance & Certificate of Compliance

## Why this, why now

Sprints 1–3 hardened the **plan-review** half of F.S. 553.791 (DNA extraction, statutory clock, county-styled comment letters, immutable hashed letter snapshots, dedupe).

The **inspections** half is still a plain checklist. From a private-provider standard, that's the single largest remaining liability:

- No required-inspections matrix per F.S. 553.79(5) / FBC 110 → provider can miss a statutorily required inspection.
- No inspection report submitted to the AHJ per F.S. 553.791(8) → no defensible record.
- **No Certificate of Compliance per F.S. 553.791(10)** → AHJ literally cannot issue the CO from our output today. This is the document our entire pipeline exists to produce.
- No photo chain-of-custody → inspection evidence is challengeable.
- No inspection-side statutory clock → overdue inspections aren't surfaced like overdue reviews are.

Everything else on the roadmap (analytics polish, more counties, AI tuning) is incremental. This one closes the loop end-to-end: **intake → review → letter → inspections → CoC → CO**.

## Scope (already detailed in `.lovable/plan.md`)

1. **Required-inspections matrix** — auto-derived from `plan_reviews.dna_extracted` (occupancy, stories, threshold flag). New `required_inspections` table + panel on `ProjectDetail`.
2. **Inspection reports** — new `inspection_reports` table + `generate-inspection-report` edge function, county-styled HTML, hashed snapshot mirroring Sprint 3's letter-snapshot pattern.
3. **Inspection readiness gate** — analog of `LetterReadinessGate` (license check, ≥3 photos, threshold special-inspector signature, narrative present).
4. **Photo chain-of-custody** — extend `file-hash.ts` to preserve EXIF (capture time, GPS); new `inspection_photos` table with sha256 + geo + timestamp.
5. **Certificate of Compliance** — new `certificate-of-compliance.ts` + `generate-coc` edge function. Verifies every required inspection passed, computes a Merkle-style chained SHA-256 over all inspection-report hashes, renders the certificate with chained hash + per-inspection attestations. Final attestation dialog (typed "I attest" + license #).
6. **Inspection statutory clock** — extend `statutory-deadlines.ts` with `computeInspectionWindow`, reuse `DeadlineBar` styling (no animations, per project memory).

## Files

**New**
- `supabase/migrations/<ts>_inspections_compliance.sql` (3 tables + RLS mirroring plan-review tables)
- `supabase/functions/generate-inspection-report/index.ts`
- `supabase/functions/generate-coc/index.ts`
- `src/lib/required-inspections.ts`
- `src/lib/inspection-readiness.ts`
- `src/lib/send-inspection-report.ts`
- `src/lib/certificate-of-compliance.ts`
- `src/components/inspections/InspectionReadinessGate.tsx`
- `src/components/inspections/InspectionReportPanel.tsx`
- `src/components/inspections/InspectionPhotoUploader.tsx`
- `src/components/CertificateOfComplianceCard.tsx`

**Edited**
- `src/pages/Inspections.tsx`, `src/pages/ProjectDetail.tsx`
- `src/lib/file-hash.ts` (EXIF-preserving variant), `src/lib/statutory-deadlines.ts`

## Acceptance criteria

- A pending project auto-generates its required inspections list from DNA; threshold projects include F.S. 553.79(5) Special Inspector items.
- Each inspection produces a hashed, county-styled report; resending requires re-hash.
- Photos store sha256 + EXIF capture time + GPS where present.
- CoC button is disabled until **every** required inspection is `pass` and signed by a license valid for that trade.
- CoC document embeds the chained hash and lists every report id + sha + inspector license.
- Overdue inspections surface in the same statutory-clock UI as overdue reviews.

## Out of scope (explicitly deferred)

- Inspector mobile app / offline capture (tablet web is fine for now).
- e-signature integrations (typed attestation + license# is statutorily acceptable).
- Multi-provider co-signing.

Approve and I'll implement in one pass, in the order above (migration first, then libs, then edge functions, then UI).
