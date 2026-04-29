## Codebase audit — what could derail this for plan reviewers

Reviewed from the perspective of a senior FE engineer + product designer. Items grouped by **how likely they are to cause a real outage / bad call** for a reviewer in production. All are pre-existing — none were introduced today (today's edits added: triage label cleanup, Projects bulk delete, Re-ground rename).

---

### Tier 1 — Will silently break reviews in production

**1. TypeScript strict mode is OFF.**
`tsconfig.json` and `tsconfig.app.json` both set `strict: false`, `strictNullChecks: false`, `noImplicitAny: false`. The project memory rule says *"Strict TS (no `as any`)"* — the codebase is the opposite. There are 45 `as any`/`as unknown as` casts, including on the live code path that decides whether a comment letter is ready to send (`src/pages/PlanReviewDetail.tsx:722` `const r: any = review as any;`). One mis-spelled field name on `review.notice_to_building_official_filed_at` and the readiness gate quietly returns "ready" when it isn't, sending an invalid letter to the building official. **Fix:** turn on `strict: true` and `strictNullChecks: true`, then walk the resulting errors.

**2. React Query has zero defaults.**
`new QueryClient()` in `src/App.tsx:30` means every query refetches on window focus and retries failed mutations indefinitely with no backoff. For a reviewer flipping between the workspace and a sheet PDF, this hammers Supabase with duplicate `deficiencies_v2` reads (68 `useQuery` sites in the codebase) and can cause findings to flicker mid-triage. **Fix:** set `defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 2 }, mutations: { retry: 1 } }`.

**3. Two parallel triage UIs share one keyboard controller.**
`useTriageController` is mounted by both `TriageInbox` (Triage tab) AND `DeficiencyList` (All-findings tab) on the same `/dashboard` route. Each instance attaches its own `keydown` listener. When the user is on the Triage tab and presses **C**, the controller in the hidden All-findings tab also fires because nothing toggles `enabled` based on the active tab. The hidden one operates on its own, separately-sorted `items` array, so you can confirm the wrong finding by index. **Fix:** pass `enabled={activeTab === "triage"}` and `enabled={activeTab === "findings"}` from `ReviewDashboard.tsx`.

**4. SECURITY DEFINER functions exposed to anon / authenticated.**
The Supabase linter flags 5 SECURITY DEFINER functions that signed-in (and in one case anonymous) users can call directly. Combined with the "RLS Policy Always True" warning, this is a privilege-escalation surface. **Fix:** revoke `EXECUTE FROM public`/`anon`/`authenticated` on internal helpers (`merge_review_progress`, `auto_advance_project_status`, etc.), keep grants only on functions called from the client.

---

### Tier 2 — Will degrade reviewer trust over time

**5. `PlanReviewDetail.tsx` is 1,258 lines with 41 hooks in one component.**
This is the page reviewers spend 80% of their time on. It mixes upload, AI streaming, letter draft, lint, readiness, file deletion, keyboard shortcuts, and 6 dialogs. Re-renders cascade — one state change re-runs every effect. **Fix:** extract the letter-send flow (the `LintDialog` + readiness fetch + sendCommentLetter chain, ~250 lines) into `usePrepareLetterSend()` and the realtime+upload progress (~200 lines) into `<UploadOrchestrator>`. No behavior change, much smaller blast radius for future edits.

**6. Overlapping z-index ladder with no scale.**
Active stacking order: `OfflineBanner z-50`, `Sidebar z-50`, `BetaFeedback z-40`, `Projects bulk-bar z-40`, `BulkActionBar z-30`, `ReviewHealthStrip z-20`. Today's bulk-delete bar (`z-40`) sits behind the offline banner (`z-50`) but in front of the floating Beta button — they overlap visually in the bottom-right. **Fix:** define `--z-skiplink: 60`, `--z-toast: 55`, `--z-banner: 50`, `--z-floating: 40`, `--z-sticky: 30`, `--z-base: 10` in `index.css` and reference them everywhere. One source of truth.

**7. `qcStatus: string` everywhere — should be a union.**
`qc_status` flows through `LetterReadinessGate`, `letter-readiness.ts`, `ReviewDashboard`, `DocumentsGen` as `string`. The readiness gate compares it to `"qc_approved"` literally. A typo migrating the enum (e.g. `"qc-approved"`) silently passes typecheck. **Fix:** declare `export type QcStatus = "draft" | "qc_pending" | "qc_approved" | "qc_rejected"` in `src/types/index.ts` and import everywhere.

**8. 78 migrations, 25 from the past 36 hours, no consolidated schema doc.**
A new dev (or you in 3 weeks) cannot reason about `deficiencies_v2`'s actual shape without grep'ing 78 files. **Fix:** add `supabase/migrations/README.md` with one paragraph per major table — what it stores, who writes it (pipeline stage / RPC / client), who reads it. Update on table creation, not column bumps.

**9. `console.log` left in production paths.**
`src/components/CommentLetterExport.tsx` and several edge functions (`regroup-citations`, `discipline-review`) ship `console.log` on the happy path — the project memory rule says no `console.log` in production. Edge logs are fine for `console.error`, but the verbose `console.log` in client bundles leaks intent + bloats the bundle. **Fix:** drop client-side `console.log` calls; keep `console.error` behind an env check.

---

### Tier 3 — UX papercuts that erode confidence

**10. Today's ref warning** (just appeared on `Projects` after the bulk-delete dialog was added): `Function components cannot be given refs … at DeleteConfirmDialog`. The `DeleteConfirmDialog` itself is a normal function component, but it's likely being used as a `<Tooltip>`/`<Dialog>` child somewhere that calls `React.cloneElement` with a ref. **Fix:** wrap `DeleteConfirmDialog` in `React.forwardRef` and forward the ref to its outer `<Dialog>` trigger area (or, more simply, ensure Radix never gets it as an `asChild` payload — today's code doesn't do that, so the warning is likely from an indirect Tooltip wrapping the trash icon when both dialogs are mounted).

**11. The `"reviewer_disposition !== null"` triage logic counts a `"reject"` as "reviewed" the same as a `"confirm"`.**
That's correct for queue progress, but the **All-findings tab** uses the same number under "Reviewed · X of Y" — a reviewer who rejects 30 findings sees "30 reviewed" with no signal that 30 are actually rejected vs. confirmed. **Fix:** split the chip into "X confirmed · Y rejected · Z modified" on the All-findings tab; keep the Triage tab as a single progress bar.

**12. No optimistic UI on disposition writes.**
`useTriageController.apply()` awaits the Supabase update before invalidating the query, so on a slow connection the card sits there for 800ms before the next one is auto-focused. Reviewers blasting through 60 high-confidence items feel the lag. **Fix:** optimistic update via `qc.setQueryData(["deficiencies_v2", planReviewId], ...)`, then reconcile on response.

**13. No global ErrorBoundary above `BrowserRouter`.**
`ErrorBoundary` is inside `<AppLayout>`, after `AuthProvider` + `BrowserRouter`. If `AuthProvider` throws (network blip on initial session fetch) the whole app white-screens. **Fix:** wrap `<App />` in `<ErrorBoundary>` at `src/main.tsx`.

**14. `shadow-subtle` and `filter-pill` referenced but not in the design memory.**
These custom utility classes are used heavily on the Projects page. The Core memory says "0.75rem radii, frosted glass sidebars" — but several pages use `rounded-md` (0.375rem) and `rounded-sm`. Inconsistent radii make the app feel unpolished. **Fix:** audit + standardise to `rounded-lg` (0.5rem) for cards and `rounded-md` (0.375rem) for inputs/chips, and document in `mem://style/design-tokens`.

**15. `BetaFeedbackButton` patches `console.error` globally** (line 57–58 of `src/components/BetaFeedbackButton.tsx`). This monkey-patch survives across navigations and could swallow a real error if the patcher throws. **Fix:** use a one-shot effect that restores the original on unmount, and skip patching in production builds.

---

### What's actually solid (don't touch)

- The two-tier delete model (single-row + bulk with typed confirmation) — good pattern, reuses one component.
- `useFilteredDeficiencies` — single source of truth for filtering, well composed.
- The pipeline stage dispatcher with idempotent retries (`_shared/dispatcher.ts`).
- The PostgREST realtime subscription registry (`subscribeShared`) — solves a real footgun and is well documented in code comments.
- Letter immutability triggers (`protect_letter_snapshot_immutable`) — exactly right for legal records.

---

### Proposed implementation order (if you want to act on this)

If you say "implement", I'd do them in this order — biggest risk-reduction first, lowest blast radius last:

1. **Tier 1 fixes (1-day):** turn on TS strict + fix the resulting errors, set QueryClient defaults, gate the duplicate keyboard listener, revoke SECURITY DEFINER grants.
2. **Today's ref warning + global ErrorBoundary** (30 min).
3. **Optimistic disposition writes + split disposition counts** (small, high-impact reviewer UX).
4. **z-index token scale + radii audit** (1 hour, prevents future drift).
5. **PlanReviewDetail.tsx extraction** (half-day, no behavior change).

No backend migration is required for any of this except the `EXECUTE` revokes in Tier 1 #4.

Tell me which tier you want me to start on.