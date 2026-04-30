/**
 * useUploadAndPrepare — owns the file-upload + page-rasterization concern.
 *
 * Encapsulates:
 *  - `uploading` / `uploadProgress` / `uploadSuccess` flags
 *  - the `handleFileUpload` flow (chunked uploadPlanReviewFiles, toasts,
 *    cache invalidations, error surfacing)
 *  - `pageAssetCount` polling (drives the "needs preparation" banner)
 *  - the `preparePagesErrored` derivation (surfaces the browser-rasterize
 *    recovery path when the edge function bails)
 *  - `handleReprepareInBrowser` + its `reprepping` flag
 *  - the `beforeunload` guard so closing the tab mid-rasterize is hard
 *  - 5-minute upload watchdog so a hung network drop doesn't strand the user
 *  - automatic single-shot reprepare on partial rasterize, escalating to a
 *    recovery modal only if that retry also fails
 *
 * Extracted from `PlanReviewDetail.tsx` because the upload state machine
 * (uploading → preparing → pipeline → fail/recover) was tangled into a
 * page that also owns triage, letter, and viewer state.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { reprepareInBrowser } from "@/lib/reprepare-in-browser";
import type { PlanReviewRow } from "@/types";

export interface UploadProgress {
  phase: string;
  prepared: number;
  expected: number;
}

interface PipelineLikeRow {
  stage: string;
  status: string;
  error_message: string | null;
  metadata?: { error_class?: string } | null;
}

export interface RecoveryState {
  open: boolean;
  prepared: number;
  expected: number;
  failedFiles: Array<{ fileName: string; failedPages: number; sampleReason: string | null }>;
}

interface Args {
  reviewId: string | undefined;
  review: PlanReviewRow | undefined | null;
  userId: string | null | undefined;
  pipeRows: PipelineLikeRow[];
  /** Called after a successful upload so the page can reset PDF render state. */
  onUploadComplete?: () => void;
  /** Imperative navigate for the "Pipeline did not start" toast action. */
  navigateToDashboard: (reviewId: string) => void;
}

const UPLOAD_WATCHDOG_MS = 5 * 60_000;
const MIN_RASTERIZE_RATIO = 0.8;

export function useUploadAndPrepare({
  reviewId,
  review,
  userId,
  pipeRows,
  onUploadComplete,
  navigateToDashboard,
}: Args) {
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [reprepping, setReprepping] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [recovery, setRecovery] = useState<RecoveryState>({
    open: false,
    prepared: 0,
    expected: 0,
    failedFiles: [],
  });
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live page-asset count drives the "needs preparation" banner. 5s poll is
  // cheap and avoids a realtime channel for a value that only matters
  // during/right after upload.
  const { data: pageAssetCount = 0 } = useQuery({
    queryKey: ["plan-review-page-asset-count", reviewId],
    queryFn: async () => {
      if (!reviewId) return 0;
      const { count } = await supabase
        .from("plan_review_page_assets")
        .select("id", { count: "exact", head: true })
        .eq("plan_review_id", reviewId);
      return count ?? 0;
    },
    enabled: !!reviewId,
    refetchInterval: 5000,
  });

  // Detect the only error class that we can recover from in-browser. The
  // edge rasterizer fails on certain PDF features (XFA, encrypted streams);
  // pdf.js handles them so we route the user there.
  const preparePagesErrored = (() => {
    const row = pipeRows.find((r) => r.stage === "prepare_pages");
    if (!row || row.status !== "error") return false;
    const meta = row.metadata;
    const msg = (row.error_message ?? "").toLowerCase();
    return (
      meta?.error_class === "needs_browser_rasterization" ||
      msg.includes("re-prepare") ||
      msg.includes("haven't been prepared")
    );
  })();

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
        queryClient.invalidateQueries({ queryKey: ["plan-review-page-asset-count", reviewId] });
      } else {
        toast.error(result.message);
      }
      // Single consolidated warning toast (≤1) — never the historical "N+2 stack".
      if (result.warnings.length > 0) {
        toast.warning(`${result.warnings.length} page${result.warnings.length === 1 ? "" : "s"} still couldn't render`, {
          description: result.warnings.slice(0, 3).join(" · "),
        });
      }
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

      // Watchdog: if the upload+rasterize loop is still flagged 5 minutes
      // later, force-clear so the user can close the tab without an OS
      // confirm dialog. The actual rasterizer surfaces its own errors.
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
      watchdogRef.current = setTimeout(() => {
        setUploading(false);
        setUploadProgress(null);
        toast.error("Upload took too long — likely a network problem. Please retry.");
      }, UPLOAD_WATCHDOG_MS);

      try {
        const { uploadPlanReviewFiles } = await import("@/lib/plan-review-upload");
        const { count: existingPageCount } = await supabase
          .from("plan_review_page_assets")
          .select("id", { count: "exact", head: true })
          .eq("plan_review_id", review.id);

        if (!review.firm_id) {
          throw new Error("This review is missing firm context. Reload and try again.");
        }
        const result = await uploadPlanReviewFiles({
          reviewId: review.id,
          firmId: review.firm_id,
          round: review.round,
          existingFileUrls: review.file_urls || [],
          existingPageCount: existingPageCount ?? 0,
          files: Array.from(files),
          userId: userId ?? null,
          onProgress: (p) => setUploadProgress(p),
        });

        // ── Triage the outcome into ONE primary signal ──
        // Three terminal states: (a) success, (b) recoverable partial, (c) hard failure.
        if (result.partialRasterize) {
          // (b)/(c): try ONE automatic browser-side re-rasterize before bothering
          // the user. The browser is our last resort; if it can't do it now, the
          // recovery dialog is the right surface — not a transient toast.
          toast.message(
            result.hardRasterFailure
              ? "Couldn't render pages — auto-retrying in your browser…"
              : `Only ${result.pageAssetCount} of ${result.expectedPages} pages prepared — auto-retrying gaps…`,
          );
          queryClient.invalidateQueries({ queryKey: ["plan-review", review.id] });
          // Fire-and-await so we know whether to open the recovery modal.
          let postRetryCount = result.pageAssetCount;
          try {
            const retry = await reprepareInBrowser(review.id);
            if (retry.ok) postRetryCount = retry.pageAssetCount;
          } catch {
            /* swallow — postRetryCount stays at original value */
          }
          queryClient.invalidateQueries({ queryKey: ["plan-review", review.id] });
          queryClient.invalidateQueries({
            queryKey: ["plan-review-page-asset-count", review.id],
          });
          const retrySuccess =
            result.expectedPages > 0 &&
            postRetryCount / result.expectedPages >= MIN_RASTERIZE_RATIO;
          if (retrySuccess) {
            toast.success(
              `Auto-recovery worked — ${postRetryCount} of ${result.expectedPages} pages prepared. Pipeline starting.`,
            );
          } else {
            // Final failure — open the modal. ONE toast, not four.
            setRecovery({
              open: true,
              prepared: postRetryCount,
              expected: result.expectedPages,
              failedFiles: result.failedFiles,
            });
          }
        } else if (!result.pipelineStarted) {
          toast.error("Pipeline did not start — click Re-run on the dashboard.", {
            action: {
              label: "Open dashboard",
              onClick: () => navigateToDashboard(review.id),
            },
          });
        } else {
          toast.success(
            `Uploaded ${result.acceptedCount} file(s). Pipeline started — ${result.pageAssetCount} page(s) prepared.`,
          );
        }

        queryClient.invalidateQueries({ queryKey: ["plan-review", review.id] });
        queryClient.invalidateQueries({
          queryKey: ["plan-review-page-asset-count", review.id],
        });
        onUploadComplete?.();
        setUploadSuccess(true);
        setTimeout(() => setUploadSuccess(false), 2500);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed");
      } finally {
        if (watchdogRef.current) {
          clearTimeout(watchdogRef.current);
          watchdogRef.current = null;
        }
        setUploading(false);
        setUploadProgress(null);
      }
    },
    [review, userId, queryClient, onUploadComplete, navigateToDashboard],
  );

  // Block tab close while upload/rasterization is in flight — closing now
  // would leave the server holding a PDF with no page assets, requiring
  // manual reprepareInBrowser recovery later.
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

  return {
    uploading,
    uploadProgress,
    uploadSuccess,
    pageAssetCount,
    preparePagesErrored,
    reprepping,
    handleFileUpload,
    handleReprepareInBrowser,
    recovery,
    closeRecovery: () => setRecovery((r) => ({ ...r, open: false })),
  };
}
