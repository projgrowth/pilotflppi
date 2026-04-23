/**
 * useReviewActions — owns every async action triggered from PlanReviewDetail.
 *
 * Extracted from the 970-line page so the action layer can be reasoned about
 * (and eventually tested) in isolation. The page still owns layout, filters,
 * keyboard shortcuts, and right-panel state — this hook owns:
 *
 *   • runAICheck                     — confirm + invoke pipeline edge fn
 *   • handlePipelineComplete         — idempotent post-run cache invalidation
 *   • handleReprepareInBrowser       — pdf.js fallback rasterization
 *   • handleFileUpload               — round resubmission upload
 *
 * The hook returns the running state (`aiRunning`, `uploading`, etc.) plus the
 * handlers. Page wires those to the topbar / panels.
 *
 * Why a hook instead of a util module: every action interacts with React
 * Query + toast + Confirm dialog state, all of which are React-context-bound.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { reprepareInBrowser } from "@/lib/reprepare-in-browser";
import type { useConfirm } from "@/hooks/useConfirm";
import type { PlanReviewRow } from "@/types";
import type { Finding } from "@/components/FindingCard";

export interface UseReviewActionsArgs {
  review: PlanReviewRow | undefined;
  reviewId: string | undefined;
  findings: Finding[];
  userId: string | null | undefined;
  queryClient: QueryClient;
  confirm: ReturnType<typeof useConfirm>;
  /** Called by handleFileUpload after a successful round upload; the page uses it to clear cached pdf.js page images. */
  resetPages: () => void;
  /** Mutable ref the page uses to gate auto-render — reset after upload. */
  hasAutoRenderedRef: React.MutableRefObject<boolean>;
}

export interface UploadProgressState {
  phase: string;
  prepared: number;
  expected: number;
}

export function useReviewActions(args: UseReviewActionsArgs) {
  const {
    review,
    reviewId,
    findings,
    userId,
    queryClient,
    confirm,
    resetPages,
    hasAutoRenderedRef,
  } = args;
  const navigate = useNavigate();

  const [aiRunning, setAiRunning] = useState(false);
  const [aiCompleteFlash, setAiCompleteFlash] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState | null>(null);
  const [reprepping, setReprepping] = useState(false);

  // Block tab close while upload/rasterization is in flight — closing now
  // would leave the server holding a PDF with no page assets, which used to
  // require manual `reprepareInBrowser` recovery 20 minutes later.
  useEffect(() => {
    if (!uploading) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue =
        "Pages are still being prepared. Closing now will require you to re-open the project to finish.";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [uploading]);

  // Idempotent: only flips state when a run is actually in flight. A stray
  // re-fire from the stepper used to loop us into a render storm on mobile.
  const handlePipelineComplete = useCallback(() => {
    if (!aiRunning) return;
    queryClient.invalidateQueries({ queryKey: ["plan-review-findings-v2", review?.id] });
    queryClient.invalidateQueries({ queryKey: ["plan-review", reviewId] });
    setAiRunning(false);
    setAiCompleteFlash(findings.length);
    setTimeout(() => setAiCompleteFlash(null), 3000);
  }, [aiRunning, queryClient, review?.id, reviewId, findings.length]);

  const runAICheck = useCallback(async () => {
    if (!review || aiRunning) return;

    // Re-Analyze on a review that already has findings is destructive: it
    // replaces the current results and burns ~2-4 minutes of model time. The
    // button looks identical with 0 vs 47 findings, so a misclick used to be
    // silent and expensive. Confirm when there's something to lose.
    if (findings.length > 0) {
      const ok = await confirm({
        title: `Re-analyze ${findings.length} finding${findings.length === 1 ? "" : "s"}?`,
        description:
          "This will replace the current results and take 2-4 minutes. Any reviewer notes on existing findings will be kept, but the findings themselves will be regenerated.",
        confirmLabel: "Re-analyze",
        cancelLabel: "Keep current results",
        variant: "destructive",
        rememberKey: "reanalyze-with-findings",
      });
      if (!ok) return;
    }

    setAiRunning(true);
    setAiCompleteFlash(null);
    // Drop cached terminal-stage status so the freshly-mounted stepper doesn't
    // immediately see stale "complete" from the previous run and fire onComplete.
    queryClient.removeQueries({ queryKey: ["pipeline_status", review.id] });
    try {
      const { error } = await supabase.functions.invoke("run-review-pipeline", {
        body: { plan_review_id: review.id },
      });
      if (error) throw error;
      toast.message("Analysis started", { description: "Watch progress in the topbar." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to start analysis";
      toast.error(msg);
      setAiRunning(false);
    }
  }, [review, aiRunning, findings.length, confirm, queryClient]);

  const handleReprepareInBrowser = useCallback(async () => {
    if (!reviewId || reprepping) return;
    setReprepping(true);
    const t = toast.loading("Re-preparing pages in your browser…");
    try {
      const result = await reprepareInBrowser(reviewId);
      toast.dismiss(t);
      if (result.ok) {
        toast.success(result.message);
        queryClient.invalidateQueries({ queryKey: ["pipeline_status", reviewId] });
        queryClient.invalidateQueries({ queryKey: ["plan-review", reviewId] });
      } else {
        toast.error(result.message);
      }
      for (const w of result.warnings) toast.warning(w);
    } catch (e) {
      toast.dismiss(t);
      toast.error(e instanceof Error ? e.message : "Re-prepare failed");
    } finally {
      setReprepping(false);
    }
  }, [reviewId, reprepping, queryClient]);

  const handleFileUpload = useCallback(
    async (files: FileList | null) => {
      if (!files || !review) return;
      setUploading(true);
      setUploadProgress({ phase: "Starting…", prepared: 0, expected: 0 });
      try {
        const { uploadPlanReviewFiles } = await import("@/lib/plan-review-upload");
        const { count: existingPageCount } = await supabase
          .from("plan_review_page_assets")
          .select("id", { count: "exact", head: true })
          .eq("plan_review_id", review.id);

        const result = await uploadPlanReviewFiles({
          reviewId: review.id,
          round: review.round,
          existingFileUrls: review.file_urls || [],
          existingPageCount: existingPageCount ?? 0,
          files: Array.from(files),
          userId: userId ?? null,
          onProgress: (p) => setUploadProgress(p),
        });

        for (const w of result.warnings) toast.warning(w);
        if (result.partialRasterize) {
          toast.error(
            `Only ${result.pageAssetCount} of ${result.expectedPages} pages prepared. Click "Prepare pages now" to retry the gaps before analyzing.`,
            { duration: 8000 },
          );
        } else if (!result.pipelineStarted) {
          toast.error("Pipeline did not start — click Re-run on the dashboard.", {
            action: {
              label: "Open dashboard",
              onClick: () => navigate(`/plan-review/${review.id}/dashboard`),
            },
          });
        } else {
          toast.success(
            `Uploaded ${result.acceptedCount} file(s). Pipeline started — ${
              result.pageAssetCount
            } page(s) prepared in the browser.`,
          );
        }

        queryClient.invalidateQueries({ queryKey: ["plan-review", reviewId] });
        queryClient.invalidateQueries({ queryKey: ["plan-review-page-asset-count", reviewId] });
        hasAutoRenderedRef.current = false;
        resetPages();
        setUploadSuccess(true);
        setTimeout(() => setUploadSuccess(false), 2500);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
        setUploadProgress(null);
      }
    },
    [review, userId, queryClient, reviewId, navigate, resetPages, hasAutoRenderedRef],
  );

  return {
    // state
    aiRunning,
    aiCompleteFlash,
    uploading,
    uploadSuccess,
    uploadProgress,
    reprepping,
    // setters needed by the page (kept narrow)
    setAiCompleteFlash,
    // handlers
    runAICheck,
    handlePipelineComplete,
    handleReprepareInBrowser,
    handleFileUpload,
  };
}

/** Avoid an unused-warning when the page imports just the hook. */
const _unused = useRef;
void _unused;
