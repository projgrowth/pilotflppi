/**
 * Plan-review detail page — shell + layout.
 *
 * Composition only. Each concern lives in its own hook or panel:
 *  - usePlanReviewData     — review row, sibling rounds, v2 findings stream + realtime
 *  - useFindingFilters     — 4-axis filter, grouped maps, stable global indices
 *  - useRoundDiff          — round-over-round new/carried/resolved bookkeeping
 *  - useFindingStatuses    — open/resolved/deferred + debounced JSONB persistence
 *  - usePdfPageRender      — sign URLs, render pages, page-cap banner state
 *  - FindingsListPanel     — right-side accordion + filters + cards
 *  - PlanViewerPanel       — left-side drop zone / viewer / file-tabs
 *  - LetterPanel           — comment-letter editor + QC actions
 *
 * The page itself just wires those pieces into the layout, owns the keyboard
 * shortcuts (since they cross multiple panels), and handles the actions
 * (upload, generate letter, navigate).
 */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
// streamAI now consumed by useCommentLetter
import { useFirmSettings } from "@/hooks/useFirmSettings";
import { useFindingHistory } from "@/hooks/useFindingHistory";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Sparkles, Upload, ArrowLeft, PanelRightClose, PanelRight } from "lucide-react";
import { toast } from "sonner";
import { ReviewTopBar } from "@/components/plan-review/ReviewTopBar";
import { CountyPanel } from "@/components/plan-review/CountyPanel";
import { LetterPanel } from "@/components/plan-review/LetterPanel";
import { RightPanelTabs, type RightPanelMode } from "@/components/plan-review/RightPanelTabs";
import ExternalDataPanel from "@/components/plan-review/ExternalDataPanel";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { ActivityPanel } from "@/components/plan-review/ActivityPanel";
import { LetterLintDialog } from "@/components/plan-review/LetterLintDialog";
import { FindingsListPanel } from "@/components/plan-review/FindingsListPanel";
import { PlanViewerPanel } from "@/components/plan-review/PlanViewerPanel";
import { useConfirm } from "@/hooks/useConfirm";
// useLetterAutosave now consumed by useCommentLetter
import { lintCommentLetter, hasBlockingIssues, type LintIssue } from "@/lib/letter-linter";
import { cn } from "@/lib/utils";
import { isTypingTarget } from "@/lib/review-shortcuts";
import { type Finding } from "@/components/FindingCard";
import { SeverityDonut } from "@/components/SeverityDonut";
import { FindingStatusFilter, type FindingStatus } from "@/components/FindingStatusFilter";
import { type ConfidenceFilter, type QualityFilter } from "@/components/BulkTriageFilters";
import { DisciplineChecklist } from "@/components/DisciplineChecklist";
import { SitePlanChecklist } from "@/components/SitePlanChecklist";
import { isHVHZ } from "@/lib/county-utils";
import { getStatutoryStatus } from "@/lib/statutory-deadlines";
import type { PlanReviewRow, ProjectInfo } from "@/types";
import { usePlanReviewData } from "@/hooks/plan-review/usePlanReviewData";
import { useCommentLetter } from "@/hooks/plan-review/useCommentLetter";
import { useUploadAndPrepare } from "@/hooks/plan-review/useUploadAndPrepare";
import { useFindingFilters, useRoundDiff } from "@/hooks/plan-review/useFindingFilters";
import { useFindingStatuses } from "@/hooks/plan-review/useFindingStatuses";
import { usePdfPageRender } from "@/hooks/plan-review/usePdfPageRender";
import { usePipelineStatus } from "@/hooks/useReviewDashboard";
// reprepareInBrowser now consumed by useUploadAndPrepare
import { StuckRecoveryBanner } from "@/components/plan-review/StuckRecoveryBanner";
import { RoundCarryoverPanel } from "@/components/plan-review/RoundCarryoverPanel";
import { UploadProgressBar } from "@/components/plan-review/UploadProgressBar";
import { ReviewNextStepRail } from "@/components/plan-review/ReviewNextStepRail";
import { selectNextStep } from "@/lib/review-next-step";
import { ReviewProvenanceStrip } from "@/components/plan-review/ReviewProvenanceStrip";
import DNAConfirmCard from "@/components/plan-review/DNAConfirmCard";
import { sendCommentLetter } from "@/lib/send-comment-letter";
import { fetchReadinessForSend } from "@/lib/letter-readiness-fetch";
import { getCountyRequirements } from "@/lib/county-requirements/utils";
import { useFirmId } from "@/hooks/useFirmId";
import type { ReadinessResult } from "@/lib/letter-readiness";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { deletePlanReview } from "@/lib/delete-plan-review";
import { cancelPipelineForReview } from "@/lib/pipeline-cancel";

// Wand2/AlertTriangle/Loader2 previously used by inline prepare strip — now owned by ReviewNextStepRail.

// RightPanelMode now imported from RightPanelTabs to keep the union in one place.

export default function PlanReviewDetail() {
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState<"plans" | "findings">("plans");
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const justCreatedState = (location.state ?? null) as
    | { justCreated?: boolean; pendingFileCount?: number; pendingPageCount?: number }
    | null;
  const queryClient = useQueryClient();
  const { firmSettings } = useFirmSettings();
  const { user } = useAuth();
  const { data: findingHistory, refetch: refetchHistory } = useFindingHistory(id);
  const confirm = useConfirm();

  // ── Data ───────────────────────────────────────────────────────────────
  const { review, isLoading, rounds, findings } = usePlanReviewData(id);
  const { findingStatuses, updateFindingStatus } = useFindingStatuses(review, user?.id, refetchHistory);

  // Project DNA — needed so the letter prompt cites the *actual* FBC edition
  // for this project, not a hardcoded "FBC 2023" (audit C-06).
  const { data: projectDna } = useQuery({
    queryKey: ["project_dna", "letter-fbc-edition", id],
    enabled: !!id,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_dna")
        .select("fbc_edition, is_coastal, county")
        .eq("plan_review_id", id!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as { fbc_edition: string | null; is_coastal: boolean | null; county: string | null } | null;
    },
  });

  // ── Comment letter (AI streaming, autosave, hydration) ────────────────
  const {
    commentLetter,
    setCommentLetter,
    generatingLetter,
    copied,
    autosaveState,
    lastSavedAt,
    generate: streamCommentLetter,
    cancel: cancelCommentLetter,
    copy: copyLetter,
  } = useCommentLetter({ review, findings, firmSettings, projectDna });

  // ── PDF rendering ──────────────────────────────────────────────────────
  const { pageImages, renderingPages, renderProgress, renderDocumentPages, resetPages } =
    usePdfPageRender();

  // ── Pipeline error recovery ───────────────────────────────────────────
  // Re-prepare in browser is the only way out of a needs_browser_rasterization
  // failure (Edge can't rasterize PDFs reliably). Surface a banner so reviewers
  // can recover without leaving this page.
  const { data: pipeRows = [] } = usePipelineStatus(id);
  // Upload + prepare-pages flow lives in useUploadAndPrepare. The
  // hasAutoRendered ref is declared up here so the upload-complete callback
  // can reset it before resetPages() — keeps re-render of fresh uploads
  // deterministic without bouncing through a ref-via-effect dance.
  const hasAutoRendered = useRef(false);
  const {
    uploading,
    uploadProgress,
    uploadSuccess,
    pageAssetCount,
    preparePagesErrored,
    reprepping,
    handleFileUpload,
    handleReprepareInBrowser,
    recovery,
    closeRecovery,
  } = useUploadAndPrepare({
    reviewId: id,
    review,
    userId: user?.id,
    pipeRows: pipeRows as Parameters<typeof useUploadAndPrepare>[0]["pipeRows"],
    navigateToDashboard: (rid) => navigate(`/plan-review/${rid}/dashboard`),
    onUploadComplete: () => {
      hasAutoRendered.current = false;
      resetPages();
    },
  });

  // ── UI state ───────────────────────────────────────────────────────────
  // Comment-letter state lives in useCommentLetter — see below where review/findings are wired up.
  // (uploading/uploadSuccess/reprepping/uploadProgress moved to useUploadAndPrepare.)
  const [rightPanel, setRightPanel] = useState<RightPanelMode>("findings");
  const siteDataEnabled = useFeatureFlag("external_data_v1");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeFindingIndex, setActiveFindingIndex] = useState<number | null>(null);
  const findingRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [statusFilter, setStatusFilter] = useState<FindingStatus | "all">("all");
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>("all");
  const [disciplineFilter, setDisciplineFilter] = useState<string | "all">("all");
  const [sheetFilter, setSheetFilter] = useState<string | "all">("all");
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>("all");
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [repositioningIndex, setRepositioningIndex] = useState<number | null>(null);
  // showShortcuts removed — workspace shortcuts surface via the dashboard's TriageShortcutsOverlay.
  const [lintIssues, setLintIssues] = useState<LintIssue[]>([]);
  const [showLintDialog, setShowLintDialog] = useState(false);
  const [pendingReadiness, setPendingReadiness] = useState<ReadinessResult | null>(null);
  const [sending, setSending] = useState(false);
  const { firmId } = useFirmId();
  const [aiRunning, setAiRunning] = useState(false);
  const [aiCompleteFlash, setAiCompleteFlash] = useState<number | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Pipeline is "processing" when any stage row exists but the terminal
  // `complete` row hasn't landed yet — OR when the user explicitly kicked off
  // a Re-Analyze, OR when the review was just created via NewReviewDialog
  // (in which case file upload + page prep are still happening in the
  // background and pipeline rows haven't appeared yet). Drives the full-canvas
  // ProcessingOverlay so freshly-uploaded reviews show live progress instead
  // of a blank panel.
  const terminalComplete = pipeRows.some(
    (r) => r.stage === "complete" && r.status === "complete",
  );
  const hasFatalError = pipeRows.some((r) => r.status === "error");
  // The "just created" flag stays sticky until pipeline rows appear OR ~3min
  // pass (whichever comes first) so a slow upload doesn't drop the user back
  // into the empty drop zone.
  // The "just created" flag stays sticky until pipeline rows appear OR
  // ai_check_status flips to a terminal/error state OR ~60s pass — whichever
  // comes first. Previously this was 3 minutes which kept "Analyzing your
  // plans…" up long after upload had already errored.
  const [justCreatedAt] = useState<number | null>(() =>
    justCreatedState?.justCreated ? Date.now() : null,
  );
  const justCreatedFresh =
    !!justCreatedAt &&
    pipeRows.length === 0 &&
    review?.ai_check_status !== "needs_user_action" &&
    review?.ai_check_status !== "needs_human_review" &&
    Date.now() - justCreatedAt < 60_000;
  const pipelineProcessing =
    aiRunning ||
    justCreatedFresh ||
    (pipeRows.length > 0 && !terminalComplete && !hasFatalError);

  // Phase that the ProcessingOverlay should render. Walked deterministically
  // from the available signals — file_urls + page assets + pipeline rows.
  const processingPhase: import("@/components/plan-review/ProcessingOverlay").ProcessingPhase =
    useMemo(() => {
      if (pipeRows.length > 0) return "analyzing";
      if (uploading) return "uploading";
      if ((review?.file_urls?.length ?? 0) === 0) return "bootstrapping";
      // Files exist but pipeline hasn't started — page prep still running.
      return "preparing";
    }, [pipeRows.length, uploading, review?.file_urls?.length]);

  // (handleReprepareInBrowser moved to useUploadAndPrepare.)
  // (Letter hydration + autosave moved to useCommentLetter.)

  const handleRepositionConfirm = useCallback(
    async (
      _idx: number,
      _newMarkup: { page_index: number; x: number; y: number; width: number; height: number },
    ) => {
      // Findings now live in deficiencies_v2 and reference sheets, not pixel
      // coordinates. Pin repositioning isn't supported on the v2 source of
      // truth — fail loud rather than silently writing to a dead JSONB column.
      void _idx;
      void _newMarkup;
      toast.error("Pin repositioning isn't available — findings now reference sheets, not pixel coordinates.");
      setRepositioningIndex(null);
    },
    [],
  );

  // Auto-render pages when review loads with files. (hasAutoRendered ref is
  // declared earlier so the upload-complete callback can reset it.)
  useEffect(() => {
    if (
      review &&
      review.file_urls?.length > 0 &&
      pageImages.length === 0 &&
      !renderingPages &&
      !hasAutoRendered.current
    ) {
      hasAutoRendered.current = true;
      renderDocumentPages(review);
    }
  }, [review]);

  // (handleFileUpload + beforeunload guard moved to useUploadAndPrepare.)

  const createNewRound = () => {
    // New rounds belong on the v2 dashboard so deficiencies_v2 carries forward
    // correctly. The dashboard owns the only writer of pipeline output.
    if (!review) return;
    navigate(`/plan-review/${review.id}/dashboard`);
  };

  // Page-level wrapper: in addition to streaming, switch the right panel to
  // the letter tab so the user sees the AI text as it arrives.
  const generateCommentLetter = useCallback(
    async (r: PlanReviewRow) => {
      setRightPanel("letter");
      await streamCommentLetter(r);
    },
    [streamCommentLetter],
  );

  const handleAnnotationClick = useCallback((index: number) => {
    setActiveFindingIndex(index);
    setRightPanel("findings");
    const el = findingRefs.current.get(index);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const handleLocateFinding = useCallback(
    async (index: number) => {
      setActiveFindingIndex(index);
      if (pageImages.length === 0 && review && review.file_urls.length > 0) {
        await renderDocumentPages(review);
      }
    },
    [pageImages.length, review, renderDocumentPages],
  );

  // ── Reviewer keyboard shortcuts (global to the page) ───────────────────
  // Unified contract from src/lib/review-shortcuts.ts. Workspace honors only
  // the navigation subset (J/K) — disposition keys (C / Shift+R / M / S) live
  // on the dashboard's triage controller. Bare R/X/O are intentionally unbound:
  // the legacy reposition / deferred / open shortcuts no longer have v2
  // semantics and were a source of accidental writes.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (findings.length === 0) return;

      const cur = activeFindingIndex;
      const last = findings.length - 1;

      switch (e.key.toLowerCase()) {
        case "j": {
          e.preventDefault();
          setActiveFindingIndex(cur === null ? 0 : Math.min(last, cur + 1));
          break;
        }
        case "k": {
          e.preventDefault();
          setActiveFindingIndex(cur === null ? 0 : Math.max(0, cur - 1));
          break;
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeFindingIndex, findings]);

  // ── Filters & round-diff (must run unconditionally — hook order rule) ──
  // We compute these BEFORE any early-return guards so React always sees the
  // same hook count between renders. They're cheap and tolerate a missing
  // review (filtered/grouped become empty).
  const filterState = {
    status: statusFilter,
    confidence: confidenceFilter,
    discipline: disciplineFilter,
    sheet: sheetFilter,
    quality: qualityFilter,
  };
  const f = useFindingFilters(findings, findingStatuses, filterState);
  const previousFindings = (review?.previous_findings as Finding[] | undefined) || [];
  const diff = useRoundDiff(findings, previousFindings, review?.round ?? 1);

  // Pipeline completion handler — declared as a hook here (above the early
  // returns) so React's hook-order invariant holds. The stepper's internal
  // `firedForRef` already latches on the terminal row's started_at, so this
  // is called exactly once per pipeline run. Used by both the in-page
  // ProcessingOverlay and the top-bar popover stepper.
  const completeFiredFor = useRef<string | null>(null);
  const handlePipelineComplete = useCallback(() => {
    // Belt-and-braces idempotency: also key on the review id so a fresh round
    // can re-arm. The stepper handles same-round dedupe.
    const key = review?.id ?? "no-review";
    if (completeFiredFor.current === key) return;
    completeFiredFor.current = key;
    queryClient.invalidateQueries({ queryKey: ["plan-review-findings-v2", review?.id] });
    queryClient.invalidateQueries({ queryKey: ["plan-review", id] });
    queryClient.invalidateQueries({ queryKey: ["plan-review-page-asset-count", id] });
    setAiRunning(false);
    setAiCompleteFlash(findings.length);
    setTimeout(() => setAiCompleteFlash(null), 3000);
    // Auto-jump the right panel to findings (only if user is on a non-findings
    // tab) and surface a one-time toast so the completion isn't easy to miss.
    setRightPanel((prev) => (prev === "findings" ? prev : "findings"));
    toast.success(
      findings.length > 0
        ? `Review complete — ${findings.length} finding${findings.length === 1 ? "" : "s"}`
        : "Review complete — no findings",
    );
  }, [queryClient, review?.id, id, findings.length]);

  if (isLoading) {
    return (
      <div className="flex flex-col h-[calc(100vh-0px)]">
        <div className="p-4 border-b">
          <Skeleton className="h-6 w-48" />
        </div>
        <div className="flex-1 flex">
          <Skeleton className="flex-1 m-4 rounded-lg" />
          <Skeleton className="w-[420px] m-4 rounded-lg" />
        </div>
      </div>
    );
  }

  if (!review) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-0px)]">
        <div className="text-center">
          <p className="text-muted-foreground mb-3">Review not found</p>
          <Button variant="outline" size="sm" onClick={() => navigate("/plan-review")}>
            <ArrowLeft className="h-3.5 w-3.5 mr-1.5" /> Back
          </Button>
        </div>
      </div>
    );
  }

  // ── Derived ────────────────────────────────────────────────────────────
  const county = review.project?.county || "";
  const hvhz = isHVHZ(county);
  const fileUrls = review.file_urls || [];
  const contractor = review.project?.contractor || null;

  const handleMarkVisibleResolved = () => {
    if (f.visibleIndices.length === 0) return;
    f.visibleIndices.forEach((i) => {
      if (findingStatuses[findings[i]?.finding_id ?? ""] !== "resolved") updateFindingStatus(findings[i]?.finding_id ?? String(i), "resolved");
    });
    toast.success(`Marked ${f.visibleIndices.length} finding${f.visibleIndices.length === 1 ? "" : "s"} resolved`);
  };

  // F.S. 553.791 statutory deadline (30 business days, holiday-aware) —
  // replaces the old 21-calendar-day hardcode. Falls back to 30 when the
  // project hasn't been hydrated yet.
  const statutory = review.project
    ? getStatutoryStatus({
        status: (review.project as { status?: string }).status ?? "plan_review",
        review_clock_started_at:
          (review.project as { review_clock_started_at?: string | null }).review_clock_started_at ?? review.created_at,
        review_clock_paused_at:
          (review.project as { review_clock_paused_at?: string | null }).review_clock_paused_at ?? null,
        statutory_review_days:
          (review.project as { statutory_review_days?: number | null }).statutory_review_days ?? 30,
        clock_pause_history:
          ((review.project as { clock_pause_history?: unknown }).clock_pause_history ?? null) as
            | import("@/lib/statutory-deadlines").ClockPauseEvent[]
            | null,
      })
    : null;
  const daysLeft = statutory ? statutory.reviewDaysRemaining : 30;
  const projectRounds = rounds.map((r) => ({
    id: r.id,
    round: r.round,
    created_at: r.created_at,
    ai_check_status: r.ai_check_status,
    findingsCount: r.findings_count || 0,
  }));

  const hasDocuments = fileUrls.length > 0;
  const hasFindings = findings.length > 0;
  const openDashboard = () => navigate(`/plan-review/${review.id}/dashboard`);

  // ── Single "what's next" CTA ──────────────────────────────────────────
  // Replaces the previous stack of competing banners (inline prepare strip,
  // SubmittalIncompleteBanner, StuckRecoveryBanner's prepare CTA, the
  // 3-second completion flash). Priority ladder lives in
  // `src/lib/review-next-step.ts` so it's testable.
  const aiRunProgress =
    ((review as unknown as { ai_run_progress?: Record<string, unknown> | null }).ai_run_progress ?? null);
  const nextStep = selectNextStep({
    hasDocuments,
    pipelineProcessing,
    pageAssetCount,
    expectedPages: typeof aiRunProgress?.expected_pages === "number" ? aiRunProgress.expected_pages : null,
    preparePagesErrored,
    hasFatalPipelineError: hasFatalError,
    aiRunProgress,
    aiCheckStatus: review.ai_check_status,
    qcStatus: review.qc_status,
    hasCommentLetterDraft: !!(review as unknown as { comment_letter_draft?: string | null }).comment_letter_draft,
    letterSentAt: (review as unknown as { last_sent_at?: string | null }).last_sent_at ?? null,
    findings,
  });
  const handleNextStepPrimary = () => {
    switch (nextStep.kind) {
      case "upload_failed":
        fileInputRef.current?.click();
        break;
      case "needs_preparation":
      case "partial_rasterize":
        handleReprepareInBrowser();
        break;
      case "pipeline_error":
        runAICheck();
        break;
      case "needs_human_review":
        openDashboard();
        break;
      case "submittal_incomplete": {
        const idx = findings.findIndex((fnd) => /SUB001/.test(fnd.code_ref || ""));
        if (idx >= 0) {
          setActiveFindingIndex(idx);
          setRightPanel("findings");
          findingRefs.current.get(idx)?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        break;
      }
      case "dna_unconfirmed":
        openDashboard();
        break;
      case "findings_ready_no_letter":
      case "complete":
        setRightPanel("letter");
        if (!commentLetter && !generatingLetter) generateCommentLetter(review);
        break;
      case "letter_ready_to_send":
        setRightPanel("letter");
        break;
      case "sent_awaiting_resub":
        createNewRound();
        break;
    }
  };
  const handleNextStepSecondary = () => {
    if (nextStep.secondaryLabel === "Open dashboard") openDashboard();
  };

  const projectName = review.project?.name || "this review";
  const handleDeleteReview = async () => {
    if (!user || !review) return;
    setDeleting(true);
    try {
      const result = await deletePlanReview(review.id, user.id);
      toast.success(`Round deleted — removed ${result.filesRemoved} file(s)`);
      navigate(`/projects/${review.project_id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete review");
      throw err;
    } finally {
      setDeleting(false);
    }
  };

  const runAICheck = async () => {
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
  };

  // handlePipelineComplete is declared as a hook above the early returns
  // (see useCallback near useFindingFilters) — referenced here for clarity.

  const findingsListProps = {
    findings,
    filteredFindings: f.filtered,
    filteredGrouped: f.filteredGrouped,
    globalIndexMap: f.globalIndexMap,
    findingStatuses,
    activeFindingIndex,
    onLocate: handleLocateFinding,
    onReposition: setRepositioningIndex,
    onStatusChange: updateFindingStatus,
    findingRefs,
    findingHistory,
    statusFilter,
    onStatusFilterChange: setStatusFilter,
    confidenceFilter,
    onConfidenceFilterChange: setConfidenceFilter,
    disciplineFilter,
    onDisciplineFilterChange: setDisciplineFilter,
    sheetFilter,
    onSheetFilterChange: setSheetFilter,
    qualityFilter,
    onQualityFilterChange: setQualityFilter,
    openCount: f.openCount,
    resolvedCount: f.resolvedCount,
    deferredCount: f.deferredCount,
    confidenceCounts: f.confidenceCounts,
    qualityCounts: f.qualityCounts,
    disciplinesPresent: f.disciplinesPresent,
    sheetsPresent: f.sheetsPresent,
    allVisibleResolved: f.allVisibleResolved,
    onMarkVisibleResolved: handleMarkVisibleResolved,
    hasRoundDiff: diff.hasRoundDiff,
    round: review.round,
    newCount: diff.newCount,
    persistedCount: diff.persistedCount,
    newlyResolvedCount: diff.newlyResolvedCount,
    diffMap: diff.diffMap,
    hasDocuments,
    fileUrls,
    onOpenDashboard: openDashboard,
    pipelineProcessing,
    completionFlash: aiCompleteFlash,
    onDismissCompletionFlash: () => setAiCompleteFlash(null),
    onGenerateLetterClick: () => {
      setAiCompleteFlash(null);
      setRightPanel("letter");
      if (!commentLetter && !generatingLetter) generateCommentLetter(review);
    },
  };

  const letterPanelProps = {
    reviewId: review.id,
    projectId: review.project_id,
    projectName: review.project?.name || "",
    address: review.project?.address || "",
    county,
    jurisdiction: review.project?.jurisdiction || "",
    tradeType: review.project?.trade_type || "",
    round: review.round,
    aiCheckStatus: review.ai_check_status,
    qcStatus: review.qc_status || "pending_qc",
    qcNotes: review.qc_notes || "",
    hasFindings,
    findings,
    findingStatuses,
    firmSettings,
    commentLetter,
    generatingLetter,
    copied,
    userId: user?.id,
    autosaveState,
    autosaveLastSavedAt: lastSavedAt,
    onGenerateLetter: async () => {
      if (
        commentLetter &&
        !(await confirm({
          title: "Regenerate letter?",
          description: "This replaces the current draft. Your edits will be lost.",
          confirmLabel: "Regenerate",
          variant: "destructive" as const,
          rememberKey: "regen-letter",
        }))
      )
        return;
      generateCommentLetter(review);
    },
    onCancelLetter: cancelCommentLetter,
    onCopyLetter: copyLetter,
    onLetterChange: setCommentLetter,
    onSendToContractor: async () => {
      const indexedStatuses: Record<number, FindingStatus> = {};
      findings.forEach((f, i) => { if (f.finding_id && findingStatuses[f.finding_id]) indexedStatuses[i] = findingStatuses[f.finding_id]; });
      const issues = lintCommentLetter(commentLetter, findings, indexedStatuses);
      setLintIssues(issues);
      // Compute readiness from the live deficiencies_v2 rows so the gate the
      // reviewer sees in the dialog matches what we'll snapshot at send-time.
      try {
        const ctyForCoastal = (projectDna?.county ?? review.project?.county ?? "").trim();
        const countyReq = ctyForCoastal ? getCountyRequirements(ctyForCoastal) : null;
        const readiness = await fetchReadinessForSend({
          planReviewId: review.id,
          qcStatus: review.qc_status,
          noticeFiledAt: review.notice_to_building_official_filed_at ?? null,
          affidavitSignedAt: review.compliance_affidavit_signed_at ?? null,
          isThresholdBuilding: !!review.threshold_building,
          thresholdTriggers: Array.isArray(review.threshold_triggers) ? review.threshold_triggers : [],
          specialInspectorDesignated: !!review.special_inspector_designated,
          reviewerLicensedDisciplines: [],
          projectDnaMissingFields: [],
          dnaIsCoastal: projectDna?.is_coastal ?? null,
          countyAlreadyCoastal: !!(countyReq?.windBorneDebrisRegion && countyReq?.floodZoneRequired),
        });
        setPendingReadiness(readiness);
      } catch {
        setPendingReadiness(null);
      }
      setShowLintDialog(true);
    },
    onQcApprove: async (notes?: string) => {
      // FS 553.791 sign-off integrity: a reviewer cannot QC their own work.
      if (review.reviewer_id && review.reviewer_id === user?.id) {
        toast.error("You ran this review — a different team member must approve QC.");
        return;
      }
      const trimmedNotes = (notes ?? "").trim().slice(0, 4000);
      await supabase
        .from("plan_reviews")
        .update({
          qc_status: "qc_approved",
          qc_reviewer_id: user?.id,
          qc_approved_by: user?.id,
          qc_approved_at: new Date().toISOString(),
          qc_notes: trimmedNotes,
        })
        .eq("id", review.id);
      await supabase.from("activity_log").insert({
        event_type: "qc_approved",
        description: "Plan review QC approved",
        project_id: review.project_id,
        actor_id: user?.id,
        actor_type: "user",
        metadata: { notes_length: trimmedNotes.length },
      });
      queryClient.invalidateQueries({ queryKey: ["plan-review", id] });
      toast.success("QC approved — exports unlocked");
    },
    onQcReject: async (notes?: string) => {
      const trimmedNotes = (notes ?? "").trim().slice(0, 4000);
      await supabase
        .from("plan_reviews")
        .update({
          qc_status: "qc_rejected",
          qc_reviewer_id: user?.id,
          qc_notes: trimmedNotes,
        })
        .eq("id", review.id);
      await supabase.from("activity_log").insert({
        event_type: "qc_rejected",
        description: "Plan review QC rejected",
        project_id: review.project_id,
        actor_id: user?.id,
        actor_type: "user",
        metadata: { notes_length: trimmedNotes.length },
      });
      queryClient.invalidateQueries({ queryKey: ["plan-review", id] });
      toast.error("QC rejected");
    },
    onDocumentGenerated: () =>
      queryClient.invalidateQueries({ queryKey: ["project-documents", review.project_id] }),
  };

  return (
    <div className="flex flex-col h-[calc(100vh-0px)] overflow-hidden">
      <ReviewTopBar
        projectName={review.project?.name || ""}
        tradeType={review.project?.trade_type || ""}
        address={review.project?.address || ""}
        county={county}
        hvhz={hvhz}
        contractor={contractor}
        round={review.round}
        reviewId={review.id}
        daysLeft={daysLeft}
        aiRunning={aiRunning}
        aiCompleteFlash={aiCompleteFlash}
        hasFindings={hasFindings}
        rounds={projectRounds}
        pipelineProcessing={pipelineProcessing}
        onBack={() => navigate("/plan-review")}
        onRunAICheck={runAICheck}
        onNavigateRound={(rid) => navigate(`/plan-review/${rid}`)}
        onNewRound={createNewRound}
        onPipelineComplete={handlePipelineComplete}
        onOpenDashboard={openDashboard}
        onDeleteReview={() => setDeleteOpen(true)}
        onCancelPipeline={async () => {
          if (!review) return;
          const ok = await confirm({
            title: "Cancel pipeline?",
            description: "Stop the AI analysis. Already-saved findings remain. You can re-run later.",
            confirmLabel: "Cancel pipeline",
            variant: "destructive",
          });
          if (!ok) return;
          try {
            await cancelPipelineForReview(review.id);
            setAiRunning(false);
            queryClient.invalidateQueries({ queryKey: ["pipeline_status", review.id] });
            toast.success("Pipeline cancelled");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Cancel failed");
          }
        }}
      />

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        resourceLabel="round"
        expectedConfirmText={projectName}
        title={`Delete round ${review.round}?`}
        description="This soft-deletes the review round and removes uploaded plan files from storage. Findings are archived. A sent comment letter blocks deletion."
        cascadeItems={[
          "All uploaded PDFs for this round (storage)",
          "Rendered page images (storage)",
          "Findings will be archived as waived",
          "Pipeline run history will be cleared",
        ]}
        loading={deleting}
        onConfirm={handleDeleteReview}
      />

      {/* Hide the inline strip when the canvas overlay is showing the same
          counters — two upload bars on one screen reads as a bug. */}
      {!pipelineProcessing && (
        <UploadProgressBar
          uploading={uploading}
          prepared={uploadProgress?.prepared ?? 0}
          expected={uploadProgress?.expected ?? 0}
          phase={uploadProgress?.phase}
        />
      )}
      {/* Single prioritized "next step" rail. Replaces the previous stack of
          competing CTAs (inline prepare strip, SubmittalIncompleteBanner, and
          StuckRecoveryBanner's prepare CTA). Selector lives in
          src/lib/review-next-step.ts. */}
      {nextStep.kind !== "idle" || nextStep.ctaLabel ? (
        <div className="shrink-0 px-4 pt-2">
          <ReviewNextStepRail
            step={nextStep}
            busy={reprepping || aiRunning}
            onPrimary={handleNextStepPrimary}
            onSecondary={handleNextStepSecondary}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            multiple
            className="hidden"
            onChange={(e) => handleFileUpload(e.target.files)}
          />
        </div>
      ) : null}

      {/* StuckRecoveryBanner now only carries the diagnostic / informational
          variants (auto-recovery success, needs_human_review breakdown). The
          prepare-pages CTA was folded into the rail above. */}
      {(() => {
        const progress = ((review as unknown as { ai_run_progress?: Record<string, unknown> }).ai_run_progress ?? {}) as Record<string, unknown>;
        const status = (review as unknown as { ai_check_status?: string }).ai_check_status ?? null;
        const userActionStage = typeof progress.needs_user_action_stage === "string"
          ? (progress.needs_user_action_stage as string)
          : null;
        return (
          <div className="shrink-0 px-4 pt-2 empty:hidden">
            <StuckRecoveryBanner
              planReviewId={review.id}
              autoRecoveredAt={typeof progress.auto_recovered_at === "string" ? progress.auto_recovered_at : null}
              recoveredFromStage={typeof progress.auto_recovered_from_stage === "string" ? progress.auto_recovered_from_stage : null}
              recoveryCount={typeof progress.auto_recovery_count === "number" ? progress.auto_recovery_count : undefined}
              aiCheckStatus={status}
              failureReason={typeof progress.failure_reason === "string" ? progress.failure_reason : null}
              qualityBreakdown={
                progress.quality_breakdown && typeof progress.quality_breakdown === "object"
                  ? (progress.quality_breakdown as {
                      unverified_pct?: number;
                      has_hallucinated_citations?: boolean;
                      total_live_findings?: number;
                      blocker_reason?: string | null;
                    })
                  : null
              }
              needsPreparation={false}
              needsUserActionStage={userActionStage}
              onReuploadFiles={() => fileInputRef.current?.click()}
            />
          </div>
        );
      })()}

      {/* DNA confirm card — surfaces a 30-second human sanity check after
          dna_extract completes and before the reviewer dives into findings.
          Hides itself once `dna_confirmed_at` is written to ai_run_progress.
          Suppressed while the pipeline is still processing — the canvas
          overlay owns the user's attention during that window. */}
      {!pipelineProcessing && (
        <div className="shrink-0 px-4 pt-2 empty:hidden">
          <DNAConfirmCard
            planReviewId={review.id}
            aiRunProgress={(review as unknown as { ai_run_progress?: Record<string, unknown> | null }).ai_run_progress ?? null}
            onEdit={openDashboard}
          />
        </div>
      )}

      {/* Provenance / health strip — one-line trust receipt above the
          findings list. Reads useReviewHealth + project_dna + ai_run_progress. */}
      {findings.length > 0 && (
        <div className="shrink-0 px-4 pt-2 empty:hidden">
          <ReviewProvenanceStrip
            planReviewId={review.id}
            progress={(review as unknown as { ai_run_progress?: Record<string, unknown> }).ai_run_progress ?? null}
          />
        </div>
      )}

      {/* Round-2+ carryover summary — only renders when there's at least one
          carryover finding from a prior round. */}
      {review.round >= 2 && findings.length > 0 && (
        <div className="shrink-0 px-4 pt-2 empty:hidden">
          <RoundCarryoverPanel
            findings={findings}
            currentRound={review.round}
            onJumpTo={(idx) => {
              setActiveFindingIndex(idx);
              const el = findingRefs.current.get(idx);
              el?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
          />
        </div>
      )}

      {/* Page-cap banner removed — coverage is now tracked truthfully via the
          review_coverage row and surfaced as a chip in ReviewHealthStrip. */}

      {isMobile ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="shrink-0 border-b bg-card px-3 py-1.5 flex gap-1">
            <button
              onClick={() => setMobileTab("plans")}
              className={cn(
                "px-4 py-1.5 rounded-md text-xs font-medium transition-all",
                mobileTab === "plans" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted/50",
              )}
            >
              Plan Sheet
            </button>
            <button
              onClick={() => setMobileTab("findings")}
              className={cn(
                "px-4 py-1.5 rounded-md text-xs font-medium transition-all",
                mobileTab === "findings"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted/50",
              )}
            >
              Findings {hasFindings && <span className="ml-1 text-caption opacity-70">{findings.length}</span>}
            </button>
          </div>
          {mobileTab === "plans" ? (
            <div className="flex-1 flex flex-col min-w-0">
              <PlanViewerPanel
                hasDocuments={hasDocuments}
                fileUrls={fileUrls}
                pageImages={pageImages}
                renderingPages={renderingPages}
                renderProgress={renderProgress}
                uploading={uploading}
                uploadSuccess={uploadSuccess}
                pipelineProcessing={pipelineProcessing}
                processingPhase={processingPhase}
                preparedPages={uploadProgress?.prepared ?? pageAssetCount}
                expectedPages={uploadProgress?.expected ?? justCreatedState?.pendingPageCount ?? 0}
                pendingFileCount={justCreatedState?.pendingFileCount ?? fileUrls.length}
                projectName={review.project?.name}
                pendingFileNames={fileUrls.map((u) => decodeURIComponent(u.split("/").pop() || ""))}
                onPipelineComplete={handlePipelineComplete}
                onOpenDashboard={openDashboard}
                planReviewId={review.id}
                findings={findings}
                activeFindingIndex={activeFindingIndex}
                onAnnotationClick={handleAnnotationClick}
                fileInputRef={fileInputRef}
                onFileUpload={handleFileUpload}
              />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto bg-card">
              <div className="shrink-0 px-3 py-2 border-b flex items-center gap-1 overflow-x-auto">
                <RightPanelTabs
                  active={rightPanel}
                  onChange={setRightPanel}
                  findingsCount={hasFindings ? findings.length : undefined}
                  siteDataEnabled={siteDataEnabled}
                />
              </div>
              <div className="overflow-y-auto">
                {rightPanel === "findings" && (
                  <div className="p-3 space-y-2">
                    {hasFindings && (
                      <FindingStatusFilter
                        activeFilter={statusFilter}
                        counts={{
                          all: findings.length,
                          open: f.openCount,
                          resolved: f.resolvedCount,
                          deferred: f.deferredCount,
                        }}
                        onFilterChange={setStatusFilter}
                      />
                    )}
                    <FindingsListPanel
                      {...findingsListProps}
                      onLocate={(gi) => {
                        handleLocateFinding(gi);
                        setMobileTab("plans");
                      }}
                      onReposition={(gi) => {
                        setRepositioningIndex(gi);
                        setMobileTab("plans");
                      }}
                    />
                  </div>
                )}
                {rightPanel === "checklist" && (
                  <div className="p-3">
                    <DisciplineChecklist tradeType={review.project?.trade_type || "building"} findings={findings} />
                  </div>
                )}
                {rightPanel === "completeness" && (
                  <div className="p-3">
                    <SitePlanChecklist findings={findings} county={county} />
                  </div>
                )}
                {rightPanel === "letter" && <LetterPanel {...letterPanelProps} />}
                {rightPanel === "county" && <CountyPanel county={county} />}
                {rightPanel === "activity" && <ActivityPanel projectId={review.project_id} />}
                {rightPanel === "site_data" && siteDataEnabled && (
                  <ExternalDataPanel
                    planReviewId={review.id}
                    address={review.project?.address || ""}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <ResizablePanelGroup direction="horizontal" className="flex-1 overflow-hidden">
          {/* LEFT — Document viewer */}
          <ResizablePanel defaultSize={rightPanelCollapsed ? 100 : 60} minSize={35}>
            <div className="h-full flex flex-col min-w-0">
              <PlanViewerPanel
                hasDocuments={hasDocuments}
                fileUrls={fileUrls}
                pageImages={pageImages}
                renderingPages={renderingPages}
                renderProgress={renderProgress}
                uploading={uploading}
                uploadSuccess={uploadSuccess}
                pipelineProcessing={pipelineProcessing}
                processingPhase={processingPhase}
                preparedPages={uploadProgress?.prepared ?? pageAssetCount}
                expectedPages={uploadProgress?.expected ?? justCreatedState?.pendingPageCount ?? 0}
                pendingFileCount={justCreatedState?.pendingFileCount ?? fileUrls.length}
                projectName={review.project?.name}
                pendingFileNames={fileUrls.map((u) => decodeURIComponent(u.split("/").pop() || ""))}
                onPipelineComplete={handlePipelineComplete}
                onOpenDashboard={openDashboard}
                findings={findings}
                activeFindingIndex={activeFindingIndex}
                onAnnotationClick={handleAnnotationClick}
                repositioningIndex={repositioningIndex}
                onRepositionConfirm={handleRepositionConfirm}
                onRepositionCancel={() => setRepositioningIndex(null)}
                fileInputRef={fileInputRef}
                onFileUpload={handleFileUpload}
                showFileTabs
                planReviewId={review.id}
                onFileDeleted={() => {
                  queryClient.invalidateQueries({ queryKey: ["plan-review", id] });
                  queryClient.invalidateQueries({ queryKey: ["plan-review-page-asset-count", id] });
                }}
              />
            </div>
          </ResizablePanel>

          {!rightPanelCollapsed && <ResizableHandle withHandle />}

          {rightPanelCollapsed && (
            <div className="w-10 shrink-0 border-l bg-card flex flex-col items-center py-2 gap-2">
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => setRightPanelCollapsed(false)}
                title="Expand panel"
              >
                <PanelRight className="h-3.5 w-3.5" />
              </Button>
              {hasFindings && (
                <span
                  className="text-caption font-semibold text-muted-foreground"
                  style={{ writingMode: "vertical-rl" }}
                >
                  {findings.length} findings
                </span>
              )}
            </div>
          )}

          {!rightPanelCollapsed && (
            <ResizablePanel defaultSize={40} minSize={25} maxSize={55}>
              <div className="h-full flex flex-col overflow-hidden bg-card">
                <div className="shrink-0 px-3 py-2 border-b flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 mr-1"
                    onClick={() => setRightPanelCollapsed(true)}
                    title="Collapse panel"
                  >
                    <PanelRightClose className="h-3.5 w-3.5" />
                  </Button>
                  <RightPanelTabs
                    active={rightPanel}
                    onChange={setRightPanel}
                    findingsCount={hasFindings ? findings.length : undefined}
                    siteDataEnabled={siteDataEnabled}
                  />
                  {hasFindings && rightPanel === "findings" && (
                    <div className="ml-auto flex items-center gap-1.5">
                      <SeverityDonut
                        critical={f.criticalCount}
                        major={f.majorCount}
                        minor={f.minorCount}
                        size={24}
                      />
                      <span className="text-2xs text-muted-foreground">{f.openCount} open</span>
                    </div>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto">
                  {rightPanel === "findings" && (
                    <div className="p-3 space-y-2">
                      <FindingsListPanel {...findingsListProps} />
                    </div>
                  )}
                  {rightPanel === "checklist" && (
                    <div className="p-3">
                      <DisciplineChecklist tradeType={review.project?.trade_type || "building"} findings={findings} />
                    </div>
                  )}
                  {rightPanel === "completeness" && (
                    <div className="p-3">
                      <SitePlanChecklist findings={findings} county={county} />
                    </div>
                  )}
                  {rightPanel === "letter" && <LetterPanel {...letterPanelProps} />}
                  {rightPanel === "county" && <CountyPanel county={county} />}
                  {rightPanel === "activity" && <ActivityPanel projectId={review.project_id} />}
                  {rightPanel === "site_data" && siteDataEnabled && (
                    <ExternalDataPanel
                      planReviewId={review.id}
                      address={review.project?.address || ""}
                    />
                  )}
                </div>
              </div>
            </ResizablePanel>
          )}
        </ResizablePanelGroup>
      )}

      <LetterLintDialog
        open={showLintDialog}
        onOpenChange={setShowLintDialog}
        issues={lintIssues}
        blocked={hasBlockingIssues(lintIssues)}
        readinessBlockingCount={pendingReadiness?.blockingCount ?? 0}
        onConfirmSend={async (overrideReason) => {
          if (!user || !review) return;
          if (sending) return;
          setSending(true);
          try {
            const recipient =
              review.contractor_email ??
              (review.project as ProjectInfo & { contractor_email?: string | null } | null | undefined)?.contractor_email ??
              "";
            const result = await sendCommentLetter({
              planReviewId: review.id,
              projectId: review.project_id,
              round: review.round,
              recipient,
              letterHtml: commentLetter,
              findings: findings as unknown as Array<Record<string, unknown>>,
              firmInfo: (firmSettings ?? {}) as Record<string, unknown>,
              readiness:
                pendingReadiness ?? {
                  checks: [],
                  allRequiredPassing: true,
                  blockingCount: 0,
                },
              overrideReason,
              sentByUserId: user.id,
              firmId: firmId ?? null,
            });
            setShowLintDialog(false);
            toast.success("Letter sent — snapshot saved");
            queryClient.invalidateQueries({ queryKey: ["plan-review", id] });
            queryClient.invalidateQueries({ queryKey: ["project", review.project_id] });
            void result;
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to send letter");
          } finally {
            setSending(false);
          }
        }}
      />
    </div>
  );
}
