/**
 * useCommentLetter — owns AI-generated comment-letter state.
 *
 * Encapsulates:
 *  - the streaming text buffer (`commentLetter`)
 *  - the in-flight abort controller (cancel mid-stream)
 *  - generating / copied UX flags
 *  - one-shot draft hydration from the persisted `comment_letter_draft`
 *  - autosave wiring via `useLetterAutosave`
 *
 * Pulled out of `PlanReviewDetail.tsx` (which hit 1.2k lines and 41 hooks).
 * The page used to own four pieces of letter state, an abort ref, a
 * hydration ref, and three handlers — all interleaved with upload/triage
 * concerns. Co-locating them here makes the streaming contract easier to
 * reason about and prevents accidental clobbering of an in-flight stream
 * by an unrelated re-render.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { streamAI } from "@/lib/ai";
import { useLetterAutosave } from "@/hooks/useLetterAutosave";
import { getCountyRequirements } from "@/lib/county-requirements";
import type { Finding } from "@/components/FindingCard";
import type { PlanReviewRow } from "@/types";

interface FirmContext {
  firm_name?: string | null;
  license_number?: string | null;
}

interface ProjectDnaContext {
  fbc_edition?: string | null;
}

interface Args {
  review: PlanReviewRow | undefined | null;
  findings: Finding[];
  firmSettings: FirmContext | null | undefined;
  /** Project DNA (post-extraction). Used to inject the correct FBC edition
   *  into the letter prompt so we don't cite "FBC 2023" on a project that's
   *  actually under FBC 7th Edition (audit C-06). */
  projectDna?: ProjectDnaContext | null | undefined;
}

export function useCommentLetter({ review, findings, firmSettings, projectDna }: Args) {
  const [commentLetter, setCommentLetter] = useState("");
  const [generatingLetter, setGeneratingLetter] = useState(false);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const hydratedForId = useRef<string | null>(null);

  // Autosave the buffer to the row, debounced. Disabled while streaming so
  // we don't checkpoint partial paragraphs.
  const { state: autosaveState, lastSavedAt } = useLetterAutosave(
    review?.id,
    commentLetter,
    !generatingLetter,
  );

  // One-shot hydration per review id. Don't clobber an in-flight stream
  // (the ref guard handles a fast review-switch race).
  useEffect(() => {
    if (!review) return;
    if (hydratedForId.current === review.id) return;
    hydratedForId.current = review.id;
    const draft = (review as { comment_letter_draft?: string }).comment_letter_draft;
    if (typeof draft === "string" && draft.length > 0) {
      setCommentLetter(draft);
    }
  }, [review]);

  const generate = useCallback(
    async (r: PlanReviewRow) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setGeneratingLetter(true);
      setCommentLetter("");
      try {
        // Resolve county-specific resubmission deadline; defaults to 14 if
        // the county isn't in the registry. The edge function clearly labels
        // the value as "default" when the caller doesn't supply one.
        const countyKey = (r.project?.county ?? "").toString();
        const reqs = countyKey ? getCountyRequirements(countyKey) : null;
        const resubmissionDays = reqs?.resubmissionDays ?? null;
        const fbcEdition = projectDna?.fbc_edition ?? null;

        await streamAI({
          action: "generate_comment_letter",
          payload: {
            project_name: r.project?.name,
            address: r.project?.address,
            trade_type: r.project?.trade_type,
            county: r.project?.county,
            jurisdiction: r.project?.jurisdiction,
            findings,
            round: r.round,
            firm_name: firmSettings?.firm_name || undefined,
            license_number: firmSettings?.license_number || undefined,
            // Audit C-06 / H-05: cite the project's actual code edition and
            // the county's actual resubmission deadline — never hardcoded.
            fbc_edition: fbcEdition || undefined,
            resubmission_days: typeof resubmissionDays === "number" ? resubmissionDays : undefined,
          },
          onDelta: (chunk) => setCommentLetter((prev) => prev + chunk),
          onDone: () => setGeneratingLetter(false),
          signal: controller.signal,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to generate letter";
        if (msg === "AI request cancelled") {
          toast.message("Letter generation cancelled");
        } else {
          toast.error(msg);
        }
        setGeneratingLetter(false);
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [findings, firmSettings?.firm_name, firmSettings?.license_number, projectDna?.fbc_edition],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const copy = useCallback(() => {
    navigator.clipboard.writeText(commentLetter);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  }, [commentLetter]);

  return {
    commentLetter,
    setCommentLetter,
    generatingLetter,
    copied,
    autosaveState,
    lastSavedAt,
    generate,
    cancel,
    copy,
  };
}
