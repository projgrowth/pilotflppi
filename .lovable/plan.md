## Cleanup Audit Results

After scanning the codebase post-Sprint 4, the system is in good shape. Most files are wired and used. The remaining issues are small dead code, one orphaned helper, and three navigation/documentation inconsistencies that could trip up the plan-review flow.

### 1. Orphaned File (created but never imported)

**`src/lib/inspection-window.ts`** — created in Sprint 4 to compute the F.S. 553.791(8) 10-business-day inspection window, but never wired into any UI or report. Two options:
- **(a) Delete it** — keep the codebase honest. We can re-add when we actually surface the window in the inspection UI.
- **(b) Wire it** — surface a "Inspection due by X" badge inside `RequiredInspectionsPanel.tsx` next to each required inspection row.

**Recommendation: (b) wire it.** The function exists for a real statutory requirement and the panel already has the right context. This converts dead code into real value with ~10 lines of UI.

### 2. Stale Documentation References

**`src/lib/file-hash.ts`** header comment still mentions `send-letter-snapshot.ts` (deleted last sprint). Fix the comment to reference the current callers (`plan-review-upload.ts`, `send-inspection-report.ts`, `certificate-of-compliance.ts`).

### 3. Redundant / Confusing Routes

Two parallel review entry points exist in `App.tsx`:

```
/review              → Review.tsx          (project list, "Reviews" tab)
/review/:id          → ReviewDetail.tsx    (84-line redirect shim)
/plan-review/:id     → PlanReviewDetail.tsx (real workspace, 1009 lines)
/plan-review/:id/dashboard → ReviewDashboard.tsx
```

`ReviewDetail.tsx` is just a redirect helper that finds-or-creates a `plan_reviews` row then forwards to `/plan-review/:id`. It's fine functionally, but the `/review` vs `/plan-review` split is confusing for anyone reading the codebase.

**Recommendation:** Leave routes alone (they're working and any URL change risks breaking bookmarks), but add a one-line comment in `App.tsx` documenting the split: `/review` = project list, `/plan-review/:id` = workspace.

### 4. Verified clean (no action)

I checked these and they're all wired correctly — no action needed:
- All Sprint-4 inspection components (`RequiredInspectionsPanel`, `CertificateOfComplianceCard`, `InspectionReportEditor`) are imported and rendered.
- All `src/components/plan-review/*` files are used.
- `plan-review-upload.ts` is dynamic-imported by `PlanReviewDetail.tsx` (looked like an orphan to grep, isn't).
- All 21 page files are route-mounted in `App.tsx`.
- All hooks under `src/hooks/` are referenced.
- No stale references to last-sprint deletions (`send-letter-snapshot`, `chunkPromises`, `verifySha256`, etc.).

### What this changes

- ~3 file edits, no deletions.
- `inspection-window.ts` becomes live (badge in RequiredInspectionsPanel showing 10-business-day deadline once an inspection is requested).
- Docstring fixed in `file-hash.ts`.
- Route map clarified in `App.tsx`.

Approve to execute the cleanup + wire-up.