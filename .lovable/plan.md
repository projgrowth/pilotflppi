
## Sprint 4 — Private Provider Inspections Compliance (F.S. 553.791(5)(8)(10))

### Why this is the next best improvement

A Florida Private Provider under F.S. 553.791 is licensed to perform **two** services: plan review (which Sprints 1–3 have now hardened) **and** building inspections. Today the platform is excellent at the plan-review half but the inspections half (`Inspections.tsx`) is a plain checklist with **none** of the statutory plumbing — no Notice to AHJ for inspections, no Inspection Report submitted to the building official, no Certificate of Compliance at completion, no required-inspections matrix per F.S. 553.79(5), and no chain-of-custody on inspection photos. That's the single biggest "would get our license suspended" gap left in the product.

This sprint mirrors the Sprint 1–3 statutory rigor on the inspections side so a private provider can defensibly issue a **Certificate of Compliance** — the document the AHJ actually needs to issue the CO.

### Scope

**1. Required-inspections matrix per project (F.S. 553.79 + FBC 110)**

Today inspections are ad-hoc. Statute requires specific inspections per occupancy/scope (footing, slab, framing, rough-in MEP, insulation, final, plus threshold-building structural inspections by the Special Inspector). We'll generate the required list automatically from the same DNA the plan-review pipeline already extracts.

- New table `required_inspections` (project_id, inspection_type, code_basis, is_threshold_inspection, status, scheduled_for, completed_at, inspector_id, result enum 'pass'|'fail'|'partial'|'na', report_id).
- New `src/lib/required-inspections.ts` derives the list from `plan_reviews.dna_extracted` (occupancy class, stories, scope of work, threshold flag from Sprint 2). Threshold buildings get the F.S. 553.79(5) Special Inspector inspections automatically appended.
- Surface as a "Required Inspections" panel on `ProjectDetail.tsx` (gated, color-coded: not started / scheduled / passed / failed).

**2. Notice of Inspection + Inspection Report (F.S. 553.791(8))**

The private provider must submit each inspection report to the AHJ within the statutory window. Mirror the comment-letter snapshot pattern.

- New table `inspection_reports` (project_id, required_inspection_id, inspector_id, inspector_license, performed_at, result, narrative, photo_refs jsonb, deficiencies jsonb, html_snapshot, html_sha256, sent_to_ahj_at, ahj_recipient).
- New edge function `generate-inspection-report` — takes an inspection + checklist results + photos, renders a county-styled HTML report using the same template family as `county-report.ts`, returns it. Reuses Lovable AI `google/gemini-2.5-flash` for narrative generation from checklist notes.
- New `src/lib/send-inspection-report.ts` — analog of `send-letter-snapshot.ts`. Hashes HTML (SHA-256 via existing `file-hash.ts`), writes snapshot, logs `activity_log` event `inspection_report_sent`.

**3. Inspection-side readiness gate**

Mirror the letter-readiness pattern so an inspection report can't be sent without statutory prerequisites.

- New `src/lib/inspection-readiness.ts` with checks: inspector_licensed_for_trade, photos_present (≥3 per inspection), threshold_special_inspector_signed (only if `is_threshold_inspection`), narrative_present, no_open_critical_deficiencies_blocking_pass.
- New `src/components/inspections/InspectionReadinessGate.tsx` — same UX as `LetterReadinessGate.tsx`.

**4. Photo chain-of-custody**

Today photos (where they exist) aren't hashed or geo/timestamped. AHJs increasingly require EXIF retention.

- Extend `file-hash.ts` with `computeFileHashWithExif()` that preserves capture timestamp + GPS if present.
- New table `inspection_photos` (id, inspection_report_id, storage_path, sha256, captured_at, gps_lat, gps_lng, uploaded_by, deficiency_ref).
- `Inspections.tsx` upload flow writes hash + EXIF on insert.

**5. Certificate of Compliance generator (F.S. 553.791(10))**

Once **all** required inspections are passed, the private provider issues the Certificate of Compliance — this is what unlocks the AHJ's CO. This is currently impossible to produce in the app.

- New `src/lib/certificate-of-compliance.ts` — verifies every required inspection is `result='pass'` and signed by a licensed inspector for that trade; computes a single SHA-256 over the chained inspection-report hashes (Merkle-style) so the certificate is a tamper-evident attestation.
- New edge function `generate-coc` — renders the certificate (county-styled, references the chained hash, lists every inspection + report id + sha + date + inspector license).
- New `src/components/CertificateOfComplianceCard.tsx` on `ProjectDetail.tsx` — disabled with explainer until all required inspections pass; on click, opens a final attestation dialog (typed "I attest" + license# confirmation), then generates and snapshots the CoC.

**6. Inspection auto-scheduling against the statutory clock**

Reuse `statutory-deadlines.ts` so an overdue **inspection** raises the same kind of deadline alert the plan-review side gets.

- Extend `statutory-deadlines.ts` with `computeInspectionWindow(scheduledFor, jurisdiction)` — F.S. 553.791 requires the inspection within a defined window after the contractor's request, skipping FL holidays (already added in Sprint 2).
- New `InspectionDeadlineBar` reusing `DeadlineBar.tsx` styling (no animations per project memory).

### Files touched

**New**
- `supabase/migrations/<ts>_inspections_compliance.sql` — `required_inspections`, `inspection_reports`, `inspection_photos`, RLS policies mirroring plan-review tables.
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
- `src/pages/Inspections.tsx` — wire required-inspections matrix, gate, photo flow.
- `src/pages/ProjectDetail.tsx` — Required Inspections panel + CoC card.
- `src/lib/file-hash.ts` — EXIF-preserving variant.
- `src/lib/statutory-deadlines.ts` — `computeInspectionWindow`.
- `.lovable/plan.md` — Sprint 4 entry.

### Acceptance

- Opening any project auto-renders the right Required Inspections list from DNA (e.g., a 2-story SFR shows footing/slab/framing/rough-in MEP/insulation/final; a 5-story office adds threshold structural inspections).
- An inspector cannot send an inspection report without ≥3 hashed photos, a license matching the trade, and (for threshold inspections) the Special Inspector's signature.
- Each sent inspection report writes an immutable snapshot with `html_sha256`.
- The Certificate of Compliance card stays disabled until every required inspection is `pass`; once enabled, it generates a county-styled CoC whose hash chains all underlying report hashes, and writes an `activity_log` event.
- Overdue inspections surface in the same deadline UI as overdue plan reviews.

### Notes on what we are NOT doing

- Not building a mobile inspector app — desktop/tablet web is sufficient and matches current product surface.
- Not generating fake inspection data; the matrix derives from real DNA and waits for real inspector input.
- Not touching the comment-letter or plan-review pipeline; Sprints 1–3 stand.

Ready to ship Sprint 4 on approval.
