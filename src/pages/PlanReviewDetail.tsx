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
import { useState, useEffect, useRef, useCallback } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useParams, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { streamAI } from "@/lib/ai";
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
import { RightPanelTabs } from "@/components/plan-review/RightPanelTabs";
import { LetterLintDialog } from "@/components/plan-review/LetterLintDialog";
import { FindingsListPanel } from "@/components/plan-review/FindingsListPanel";
import { PlanViewerPanel } from "@/components/plan-review/PlanViewerPanel";
import { useConfirm } from "@/hooks/useConfirm";
import { useLetterAutosave } from "@/hooks/useLetterAutosave";
import { lintCommentLetter, type LintIssue } from "@/lib/letter-linter";
import { cn } from "@/lib/utils";
import { type Finding } from "@/components/FindingCard";
import { SeverityDonut } from "@/components/SeverityDonut";
import { FindingStatusFilter, type FindingStatus } from "@/components/FindingStatusFilter";
import { type ConfidenceFilter } from "@/components/BulkTriageFilters";
import { DisciplineChecklist } from "@/components/DisciplineChecklist";
import { SitePlanChecklist } from "@/components/SitePlanChecklist";
import { isHVHZ } from "@/lib/county-utils";
import type { PlanReviewRow } from "@/types";
import { usePlanReviewData } from "@/hooks/plan-review/usePlanReviewData";
import { useFindingFilters, useRoundDiff } from "@/hooks/plan-review/useFindingFilters";
import { useFindingStatuses } from "@/hooks/plan-review/useFindingStatuses";
import { usePdfPageRender } from "@/hooks/plan-review/usePdfPageRender";

type RightPanelMode = "findings" | "checklist" | "completeness" | "letter" | "county";

function getDaysRemaining(createdAt: string): number {
  const deadline = new Date(createdAt);
  deadline.setDate(deadline.getDate() + 21);
  const now = new Date();
  return Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
}

export default function PlanReviewDetail() {
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState<"plans" | "findings">("plans");
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { firmSettings } = useFirmSettings();
  const { user } = useAuth();
  const { data: findingHistory, refetch: refetchHistory } = useFindingHistory(id);
  const confirm = useConfirm();

  // ── Data ───────────────────────────────────────────────────────────────
  const { review, isLoading, rounds, findings } = usePlanReviewData(id);
  const { findingStatuses, updateFindingStatus } = useFindingStatuses(review, user?.id, refetchHistory);

  // ── PDF rendering ──────────────────────────────────────────────────────
  const { pageImages, pageCapInfo, renderingPages, renderProgress, renderDocumentPages, resetPages } =
    usePdfPageRender();

  // ── UI state ───────────────────────────────────────────────────────────
  const [commentLetter, setCommentLetter] = useState("");
  const [generatingLetter, setGeneratingLetter] = useState(false);
  const letterAbortRef = useRef<AbortController | null>(null);
  const [copied, setCopied] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [rightPanel, setRightPanel] = useState<RightPanelMode>("findings");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeFindingIndex, setActiveFindingIndex] = useState<number | null>(null);
  const findingRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [statusFilter, setStatusFilter] = useState<FindingStatus | "all">("all");
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>("all");
  const [disciplineFilter, setDisciplineFilter] = useState<string | "all">("all");
  const [sheetFilter, setSheetFilter] = useState<string | "all">("all");
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [repositioningIndex, setRepositioningIndex] = useState<number | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [lintIssues, setLintIssues] = useState<LintIssue[]>([]);
  const [showLintDialog, setShowLintDialog] = useState(false);
  const letterHydratedRef = useRef<string | null>(null);

  // Autosave the comment letter to the review row, debounced.
  const { state: autosaveState, lastSavedAt } = useLetterAutosave(review?.id, commentLetter, !generatingLetter);

  // Hydrate the letter draft once per review id (don't clobber in-flight stream).
  useEffect(() => {
    if (!review) return;
    if (letterHydratedRef.current === review.id) return;
    letterHydratedRef.current = review.id;
    const draft = (review as { comment_letter_draft?: string }).comment_letter_draft;
    if (typeof draft === "string" && draft.length > 0) {
      setCommentLetter(draft);
    }
  }, [review?.id]);

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

  // Auto-render pages when review loads with files
  const hasAutoRendered = useRef(false);
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

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || !review) return;
    setUploading(true);
    try {
      const newUrls: string[] = [...(review.file_urls || [])];
      const newFilePaths: string[] = [];
      for (const file of Array.from(files)) {
        const lowerName = file.name.toLowerCase();
        if (file.type !== "application/pdf" && !lowerName.endsWith(".pdf")) {
          toast.error(`${file.name} is not a PDF`);
          continue;
        }
        if (file.size > 100 * 1024 * 1024) {
          toast.error(`${file.name} exceeds 100 MB`);
          continue;
        }
        if (file.size === 0) {
          toast.error(`${file.name} is empty`);
          continue;
        }
        const path = `plan-reviews/${review.id}/${file.name}`;
        const { error: uploadError } = await supabase.storage.from("documents").upload(path, file, { upsert: true });
        if (uploadError) throw uploadError;
        newUrls.push(path);
        newFilePaths.push(path);
      }
      await supabase.from("plan_reviews").update({ file_urls: newUrls }).eq("id", review.id);

      if (newFilePaths.length > 0) {
        await supabase.from("plan_review_files").insert(
          newFilePaths.map((fp) => ({
            plan_review_id: review.id,
            file_path: fp,
            round: review.round,
            uploaded_by: user?.id || null,
          })),
        );
      }

      queryClient.invalidateQueries({ queryKey: ["plan-review", id] });
      hasAutoRendered.current = false;
      resetPages();
      setUploadSuccess(true);
      setTimeout(() => setUploadSuccess(false), 2500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const createNewRound = () => {
    // New rounds belong on the v2 dashboard so deficiencies_v2 carries forward
    // correctly. The dashboard owns the only writer of pipeline output.
    if (!review) return;
    navigate(`/plan-review/${review.id}/dashboard`);
  };

  const generateCommentLetter = async (r: PlanReviewRow) => {
    letterAbortRef.current?.abort();
    const controller = new AbortController();
    letterAbortRef.current = controller;

    setGeneratingLetter(true);
    setCommentLetter("");
    setRightPanel("letter");
    try {
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
      if (letterAbortRef.current === controller) letterAbortRef.current = null;
    }
  };

  const cancelCommentLetter = () => {
    letterAbortRef.current?.abort();
  };

  const copyLetter = () => {
    navigator.clipboard.writeText(commentLetter);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

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
  // J / K — next / prev finding · R — reposition · S — resolved · X — deferred · O — open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
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
        case "r": {
          if (cur !== null && findings[cur]?.markup) {
            e.preventDefault();
            setRepositioningIndex(cur);
          }
          break;
        }
        case "s": {
          if (cur !== null) {
            e.preventDefault();
            updateFindingStatus(cur, "resolved");
          }
          break;
        }
        case "x": {
          if (cur !== null) {
            e.preventDefault();
            updateFindingStatus(cur, "deferred");
          }
          break;
        }
        case "o": {
          if (cur !== null) {
            e.preventDefault();
            updateFindingStatus(cur, "open");
          }
          break;
        }
        case "?": {
          e.preventDefault();
          setShowShortcuts((s) => !s);
          break;
        }
        case "escape": {
          if (showShortcuts) {
            e.preventDefault();
            setShowShortcuts(false);
          }
          break;
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeFindingIndex, findings, updateFindingStatus, showShortcuts]);

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
  const previousFindings = (review.previous_findings as Finding[]) || [];
  const county = review.project?.county || "";
  const hvhz = isHVHZ(county);
  const fileUrls = review.file_urls || [];
  const contractor = review.project?.contractor || null;

  const filterState = {
    status: statusFilter,
    confidence: confidenceFilter,
    discipline: disciplineFilter,
    sheet: sheetFilter,
  };
  const f = useFindingFilters(findings, findingStatuses, filterState);
  const diff = useRoundDiff(findings, previousFindings, review.round);

  const handleMarkVisibleResolved = () => {
    if (f.visibleIndices.length === 0) return;
    f.visibleIndices.forEach((i) => {
      if (findingStatuses[i] !== "resolved") updateFindingStatus(i, "resolved");
    });
    toast.success(`Marked ${f.visibleIndices.length} finding${f.visibleIndices.length === 1 ? "" : "s"} resolved`);
  };

  const daysLeft = getDaysRemaining(review.created_at);
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
    openCount: f.openCount,
    resolvedCount: f.resolvedCount,
    deferredCount: f.deferredCount,
    confidenceCounts: f.confidenceCounts,
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
    onSendToContractor: () => {
      const issues = lintCommentLetter(commentLetter, findings, findingStatuses);
      setLintIssues(issues);
      setShowLintDialog(true);
    },
    onQcApprove: async () => {
      // FS 553.791 sign-off integrity: a reviewer cannot QC their own work.
      if (review.reviewer_id && review.reviewer_id === user?.id) {
        toast.error("You ran this review — a different team member must approve QC.");
        return;
      }
      await supabase
        .from("plan_reviews")
        .update({ qc_status: "qc_approved", qc_reviewer_id: user?.id })
        .eq("id", review.id);
      await supabase.from("activity_log").insert({
        event_type: "qc_approved",
        description: "Plan review QC approved",
        project_id: review.project_id,
        actor_id: user?.id,
        actor_type: "user",
      });
      queryClient.invalidateQueries({ queryKey: ["plan-review", id] });
      toast.success("QC approved — exports unlocked");
    },
    onQcReject: async () => {
      await supabase
        .from("plan_reviews")
        .update({ qc_status: "qc_rejected", qc_reviewer_id: user?.id })
        .eq("id", review.id);
      await supabase.from("activity_log").insert({
        event_type: "qc_rejected",
        description: "Plan review QC rejected",
        project_id: review.project_id,
        actor_id: user?.id,
        actor_type: "user",
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
        aiRunning={false}
        aiCompleteFlash={null}
        hasFindings={hasFindings}
        rounds={projectRounds}
        onBack={() => navigate("/plan-review")}
        onRunAICheck={openDashboard}
        onNavigateRound={(rid) => navigate(`/plan-review/${rid}`)}
        onNewRound={createNewRound}
      />

      {/* Page-cap banner: surface silent 10-page truncation honestly */}
      {pageCapInfo && pageCapInfo.total > pageCapInfo.rendered && (
        <div className="shrink-0 border-b bg-warning/10 px-4 py-1.5 flex items-center gap-2">
          <span className="text-2xs font-semibold text-warning uppercase tracking-wide">Limited review</span>
          <span className="text-xs text-foreground/80">
            Reviewing the first <strong>{pageCapInfo.rendered}</strong> of <strong>{pageCapInfo.total}</strong> sheet
            {pageCapInfo.total !== 1 ? "s" : ""}. Findings on later sheets cannot be detected by AI in this round.
          </span>
        </div>
      )}

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
              </div>
            </div>
          )}
        </div>
      ) : (
        <ResizablePanelGroup direction="horizontal" className="flex-1 overflow-hidden">
          {/* LEFT — Document viewer */}
          <ResizablePanel defaultSize={rightPanelCollapsed ? 100 : 65} minSize={35}>
            <div className="h-full flex flex-col min-w-0">
              <PlanViewerPanel
                hasDocuments={hasDocuments}
                fileUrls={fileUrls}
                pageImages={pageImages}
                renderingPages={renderingPages}
                renderProgress={renderProgress}
                uploading={uploading}
                uploadSuccess={uploadSuccess}
                findings={findings}
                activeFindingIndex={activeFindingIndex}
                onAnnotationClick={handleAnnotationClick}
                repositioningIndex={repositioningIndex}
                onRepositionConfirm={handleRepositionConfirm}
                onRepositionCancel={() => setRepositioningIndex(null)}
                fileInputRef={fileInputRef}
                onFileUpload={handleFileUpload}
                showFileTabs
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
            <ResizablePanel defaultSize={35} minSize={20} maxSize={55}>
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
        onProceed={() => {
          setShowLintDialog(false);
          toast.success("Letter ready to send");
        }}
      />
    </div>
  );
}
