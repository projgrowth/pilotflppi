

# Document Generators Hanging — Root Cause & Fix Plan

## What I found across all 3 generators

### 1. AI Comment Letter (Plan Review Detail) — **stream silently dies**
`generateCommentLetter` in `PlanReviewDetail.tsx` calls `streamAI` from `src/lib/ai.ts`. The stream parser has a fragile flow:
- No timeout — if the upstream Lovable AI gateway stalls, the spinner runs forever.
- The `[DONE]` sentinel is checked, but on a partial JSON line the code re-buffers `line + "\n" + buffer` then `break`s — if the next chunk never arrives, `onDone()` is never called.
- The edge function (`supabase/functions/ai/index.ts`) returns `response.body` directly when `stream:true`. If the gateway times out mid-stream, the client's `reader.read()` sits forever waiting for a chunk that won't come.
- No `AbortController` — user can't cancel.

### 2. Documents page (`/documents`) — **dialog opens with empty preview**
`DocumentsPage.handleGenerate` only generates HTML for `"Review Comment Letter"`. The other 4 docs (Plan Compliance Affidavit, Notice to Building Official, Log of Approved Documents, Inspection Record) just open the dialog and show "Document preview will be generated…" — they have **no generator implementation**. To the user this looks like the generator is stuck.

### 3. County Document Package + Save as PDF — **iframe print never fires when popup is blocked or onload misses**
`printViaIframe` in both `CommentLetterExport.tsx` and `CountyDocumentPackage.tsx`:
- Sets `iframe.onload` AFTER calling `doc.write/close()`. If the document loads synchronously (very small HTML), `onload` may fire before the handler is attached → print never happens, iframe stays hidden in DOM forever.
- No error path, no toast, no fallback download. User clicks → toast says "select Save as PDF" → nothing visible happens.
- `persistToStorage` swallows all errors silently inside an empty catch, so storage failures are invisible too.

---

## Fix plan (3 patches, no schema/edge-function changes)

### Patch A — Make `streamAI` cancellable & timeout-safe (`src/lib/ai.ts`)
- Accept an optional `AbortSignal`.
- Add a 60s inactivity watchdog: if no SSE chunk arrives for 60s, abort the reader and reject with `"AI stream stalled"`.
- Always call `onDone()` in a `finally` block so the spinner clears even on error.
- Fix the partial-line re-buffer bug: when JSON.parse fails, leave the partial in `buffer` and exit the inner loop without prepending the consumed line again (avoids duplicate parse attempts on the same byte).

### Patch B — Make `printViaIframe` reliable (one shared util in `src/lib/print-utils.ts`)
- Extract the helper out of both files into `src/lib/print-utils.ts` and import it in `CommentLetterExport.tsx` and `CountyDocumentPackage.tsx` (kills the duplicate too).
- Attach `onload` BEFORE `doc.write()`, and use `srcdoc` instead of write/close for synchronous-friendly load.
- Wrap `iframe.contentWindow?.print()` in a try/catch; on failure, automatically trigger a `.html` download fallback and toast "Print dialog blocked — file downloaded instead."
- Add a 10s safety timer to remove the iframe even if `onload` never fires.

### Patch C — Wire up the 4 missing document generators on `/documents`
Three options here, listed in order of complexity:

**Recommended: implement them as static HTML templates** (matches the existing comment-letter pattern in the same file). Add four `generate*Html()` functions:
- `generatePlanComplianceAffidavitHtml(project, firm)` — short statutory affidavit per F.S. 553.791.
- `generateNoticeToBuildingOfficialHtml(project, firm)` — required pre-service notice with firm credentials.
- `generateApprovedDocumentsLogHtml(project, planReviews)` — table of approved sheets pulled from `plan_reviews` rows where `qc_status='qc_approved'`.
- `generateInspectionRecordHtml(project, inspections)` — pulls from `inspections` table.

Update `handleGenerate` to dispatch by `docTitle` and set `generatedHtml`. Reuse the existing preview/copy/download UI — no new components needed.

Add two new hooks (or inline queries): pull `plan_reviews` and `inspections` for the selected project so the Log and Record can populate.

---

## Files touched
- `src/lib/ai.ts` — add abort + watchdog + finally
- `src/lib/print-utils.ts` — **new**, shared `printViaIframe` with fallback
- `src/components/CommentLetterExport.tsx` — import from new util, drop local copy
- `src/components/CountyDocumentPackage.tsx` — import from new util, drop local copy
- `src/pages/DocumentsGen.tsx` — add 4 HTML generators + queries for plan_reviews/inspections + dispatch
- `src/pages/PlanReviewDetail.tsx` — pass `AbortController` to `streamAI`, add Cancel button on the letter panel

## What I'm NOT doing
- No edge function changes (per project constraints; the AI function itself is fine — the hang is on the client stream reader).
- No queue/job-table architecture. The longest real operation is an AI stream; a 60s watchdog + cancel button is the right surface area for that, not a full background-job system.
- No changes to `supabase/config.toml`, routing, or auth.

## Verification after implementation
- Generate Comment Letter on a plan review → progressive text appears → finishes → spinner clears.
- Force-stall test: kill network mid-stream → spinner clears within 60s with a "stream stalled" toast, Cancel button works.
- Click each of the 5 cards on `/documents` → preview renders within ~100ms, Copy/Download both work.
- Click "Save as PDF" and "Docs → Inspection Readiness Packet" → print dialog opens; if blocked, `.html` falls back to download.
- `tsc --noEmit` passes.

