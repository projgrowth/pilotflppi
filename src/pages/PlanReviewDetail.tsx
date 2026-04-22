import { useState, useEffect, useRef, useCallback } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { streamAI } from "@/lib/ai";
import { renderPDFPagesToImages, getPDFPageCount, type PDFPageImage } from "@/lib/pdf-utils";
import { useFirmSettings } from "@/hooks/useFirmSettings";
import { useFindingHistory, logFindingStatusChange } from "@/hooks/useFindingHistory";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import {
 Sparkles, Loader2, Check,
 Upload, ArrowLeft,
 PanelRightClose, PanelRight,
} from "lucide-react";
import { toast } from "sonner";
import { ReviewTopBar } from "@/components/plan-review/ReviewTopBar";
import { CountyPanel } from "@/components/plan-review/CountyPanel";
import { LetterPanel } from "@/components/plan-review/LetterPanel";
import { RightPanelTabs } from "@/components/plan-review/RightPanelTabs";
import { LetterLintDialog } from "@/components/plan-review/LetterLintDialog";
import { useConfirm } from "@/hooks/useConfirm";
import { useLetterAutosave } from "@/hooks/useLetterAutosave";
import { lintCommentLetter, type LintIssue } from "@/lib/letter-linter";
import { cn } from "@/lib/utils";
import { FindingCard, type Finding } from "@/components/FindingCard";
import { SeverityDonut } from "@/components/SeverityDonut";
import { PlanMarkupViewer } from "@/components/PlanMarkupViewer";
import { FindingStatusFilter, type FindingStatus } from "@/components/FindingStatusFilter";
import { BulkTriageFilters, type ConfidenceFilter } from "@/components/BulkTriageFilters";
import { DisciplineChecklist } from "@/components/DisciplineChecklist";
import { SitePlanChecklist } from "@/components/SitePlanChecklist";
import {
 isHVHZ, getDisciplineIcon, getDisciplineColor,
 getDisciplineLabel, DISCIPLINE_ORDER,
} from "@/lib/county-utils";
import type { PlanReviewRow } from "@/types";
import { adaptV2ToFindings, type DeficiencyV2Lite } from "@/lib/deficiency-adapter";

type RightPanelMode = "findings" | "checklist" | "completeness" | "letter" | "county";

function groupFindingsByDiscipline(findings: Finding[]): Record<string, Finding[]> {
 const groups: Record<string, Finding[]> = {};
 for (const f of findings) {
 const d = f.discipline || "structural";
 if (!groups[d]) groups[d] = [];
 groups[d].push(f);
 }
 return groups;
}

function getWorstSeverity(findings: Finding[]): string {
 if (findings.some((f) => f.severity === "critical")) return "critical";
 if (findings.some((f) => f.severity === "major")) return "major";
 return "minor";
}

// (withRetry helper removed — only used by the retired in-page AI runner.)

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

 const { data: review, isLoading } = useQuery({
 queryKey: ["plan-review", id],
 queryFn: async () => {
 const { data, error } = await supabase
 .from("plan_reviews")
 .select("*, project:projects(id, name, address, trade_type, county, jurisdiction, contractor:contractors(id, name, email, phone, license_number))")
 .eq("id", id!)
 .single();
 if (error) throw error;
 return data as PlanReviewRow;
 },
 enabled: !!id,
 });

 const { data: allRounds } = useQuery({
 queryKey: ["plan-review-rounds", review?.project_id],
 queryFn: async () => {
 const { data, error } = await supabase
 .from("plan_reviews")
 .select("id, round, created_at, ai_check_status")
 .eq("project_id", review!.project_id)
 .order("round");
 if (error) throw error;
 const ids = (data || []).map((r) => r.id);
 if (ids.length === 0) return (data || []).map((r) => ({ ...r, findings_count: 0 }));
 const { data: defs } = await supabase
 .from("deficiencies_v2")
 .select("plan_review_id")
 .in("plan_review_id", ids);
 const counts = new Map<string, number>();
 (defs || []).forEach((d) => counts.set(d.plan_review_id, (counts.get(d.plan_review_id) || 0) + 1));
 return (data || []).map((r) => ({ ...r, findings_count: counts.get(r.id) || 0 }));
 },
 enabled: !!review?.project_id,
 });

  // Findings live in deficiencies_v2 (verified, dedup'd, with human-review
  // flags). The adapter shapes them into the legacy Finding interface so the
  // existing PDF viewer, comment letter, lint, and SitePlanChecklist consume
  // V2 data without bespoke V2 components. Nothing writes to ai_findings
  // anymore — pipeline runs, dispositions, and new rounds happen on the
  // /dashboard route, which is the sole writer of deficiencies_v2.
  const { data: v2Findings } = useQuery({
    queryKey: ["v2-findings-for-viewer", review?.id],
    enabled: !!review?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deficiencies_v2")
        .select(
          "id, def_number, discipline, finding, required_action, sheet_refs, code_reference, evidence, confidence_score, confidence_basis, priority, life_safety_flag, permit_blocker, liability_flag, requires_human_review, human_review_reason, verification_status, status, model_version",
        )
        .eq("plan_review_id", review!.id)
        .order("def_number", { ascending: true });
      if (error) throw error;
      return adaptV2ToFindings((data ?? []) as DeficiencyV2Lite[]);
    },
  });

  // Realtime: as the v2 pipeline writes new findings, refetch so the viewer
  // streams them in (same pattern as the dashboard).
  useEffect(() => {
    if (!review?.id) return;
    const channel = supabase
      .channel(`plan-review-detail-defs-${review.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "deficiencies_v2", filter: `plan_review_id=eq.${review.id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["v2-findings-for-viewer", review.id] });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [review?.id, queryClient]);

  const [commentLetter, setCommentLetter] = useState("");
  const [generatingLetter, setGeneratingLetter] = useState(false);
  const letterAbortRef = useRef<AbortController | null>(null);
  const [copied, setCopied] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [rightPanel, setRightPanel] = useState<RightPanelMode>("findings");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeFindingIndex, setActiveFindingIndex] = useState<number | null>(null);
  const [pageImages, setPageImages] = useState<PDFPageImage[]>([]);
  /** {totalSheets, renderedSheets} — populated after we open the PDFs. Used to show the "Reviewing first 10 of N" banner. */
  const [pageCapInfo, setPageCapInfo] = useState<{ total: number; rendered: number } | null>(null);
  const [renderingPages, setRenderingPages] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const findingRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [findingStatuses, setFindingStatuses] = useState<Record<number, FindingStatus>>({});
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
  const { state: autosaveState, lastSavedAt, dirty: letterDirty } = useLetterAutosave(
    review?.id,
    commentLetter,
    !generatingLetter,
  );

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

  const handleRepositionConfirm = useCallback(async (_idx: number, _newMarkup: { page_index: number; x: number; y: number; width: number; height: number }) => {
    // Findings now live in deficiencies_v2 and reference sheets, not pixel
    // coordinates. Pin repositioning isn't supported on the v2 source of
    // truth — fail loud rather than silently writing to a dead JSONB column.
    void _idx;
    void _newMarkup;
    toast.error("Pin repositioning isn't available — findings now reference sheets, not pixel coordinates.");
    setRepositioningIndex(null);
  }, []);

  useEffect(() => {
    if (review?.finding_statuses) {
      const loaded: Record<number, FindingStatus> = {};
      for (const [k, v] of Object.entries(review.finding_statuses as Record<string, string>)) {
        loaded[Number(k)] = v as FindingStatus;
      }
      setFindingStatuses(loaded);
    } else {
      setFindingStatuses({});
    }
  }, [review?.id]);

  // Auto-render pages when review loads with files
  const hasAutoRendered = useRef(false);
  useEffect(() => {
    if (review && review.file_urls?.length > 0 && pageImages.length === 0 && !renderingPages && !hasAutoRendered.current) {
      hasAutoRendered.current = true;
      renderDocumentPages(review);
    }
  }, [review]);


 const statusSaveTimer = useRef<NodeJS.Timeout | null>(null);
 const persistFindingStatuses = useCallback((reviewId: string, statuses: Record<number, FindingStatus>) => {
 if (statusSaveTimer.current) clearTimeout(statusSaveTimer.current);
 statusSaveTimer.current = setTimeout(async () => {
 await supabase
 .from("plan_reviews")
 .update({ finding_statuses: JSON.parse(JSON.stringify(statuses)) })
 .eq("id", reviewId);
 }, 800);
 }, []);

 const updateFindingStatus = useCallback((index: number, status: FindingStatus) => {
 setFindingStatuses((prev) => {
 const oldStatus = prev[index] || "open";
 const next = { ...prev, [index]: status };
 if (review) {
 persistFindingStatuses(review.id, next);
 if (user && oldStatus !== status) {
 logFindingStatusChange(review.id, index, oldStatus, status, user.id)
 .then(() => refetchHistory());
 }
 }
 return next;
 });
 }, [review, persistFindingStatuses, user, refetchHistory]);

  // (scan-step ticker removed — no in-page AI run to drive it.)

 const handleFileUpload = async (files: FileList | null) => {
 if (!files || !review) return;
 setUploading(true);
 try {
 const newUrls: string[] = [...(review.file_urls || [])];
 const newFilePaths: string[] = [];
  for (const file of Array.from(files)) {
   const lowerName = file.name.toLowerCase();
   if (file.type !== "application/pdf" && !lowerName.endsWith(".pdf")) { toast.error(`${file.name} is not a PDF`); continue; }
   if (file.size > 100 * 1024 * 1024) { toast.error(`${file.name} exceeds 100 MB`); continue; }
   if (file.size === 0) { toast.error(`${file.name} is empty`); continue; }
 const path = `plan-reviews/${review.id}/${file.name}`;
 const { error: uploadError } = await supabase.storage.from("documents").upload(path, file, { upsert: true });
 if (uploadError) throw uploadError;
 newUrls.push(path);
 newFilePaths.push(path);
 }
 await supabase.from("plan_reviews").update({ file_urls: newUrls }).eq("id", review.id);
 
 // Also track in plan_review_files
 if (newFilePaths.length > 0) {
 await supabase.from("plan_review_files").insert(
 newFilePaths.map(fp => ({
 plan_review_id: review.id,
 file_path: fp,
 round: review.round,
 uploaded_by: user?.id || null,
 }))
 );
 }
 
 queryClient.invalidateQueries({ queryKey: ["plan-review", id] });
 hasAutoRendered.current = false;
 setUploadSuccess(true);
 setTimeout(() => setUploadSuccess(false), 2500);
 } catch (err) {
 toast.error(err instanceof Error ? err.message : "Upload failed");
 } finally {
 setUploading(false);
 }
 };


 const renderDocumentPages = async (r: PlanReviewRow): Promise<PDFPageImage[]> => {
 if (!r.file_urls || r.file_urls.length === 0) return [];
 setRenderingPages(true);
 setRenderProgress(0);
 try {
 const allImages: PDFPageImage[] = [];
 // (text-layer index removed alongside the v1 AI runner; kept image rendering only.)
 let totalSheetsAcrossFiles = 0;
 let renderedSheetsAcrossFiles = 0;
 for (let fi = 0; fi < r.file_urls.length; fi++) {
 const storedPath = r.file_urls[fi];
 if (!storedPath) continue;
 // Legacy entries stored full public URLs; new entries store storage paths.
 const filePath = storedPath.includes('/storage/v1/')
 ? storedPath.split('/documents/').pop() || storedPath
 : storedPath;
 const { data: signedData, error: signError } = await supabase.storage
 .from("documents")
 .createSignedUrl(filePath, 3600);
 if (signError || !signedData?.signedUrl) continue;
 const response = await fetch(signedData.signedUrl);
 const blob = await response.blob();
 const fileName = decodeURIComponent(filePath.split("/").pop() || `doc-${fi}.pdf`);
 const file = new File([blob], fileName, { type: "application/pdf" });

 // Track total page count for the cap banner before rendering caps to 10.
 try {
 const total = await getPDFPageCount(file);
 totalSheetsAcrossFiles += total;
 renderedSheetsAcrossFiles += Math.min(total, 10);
 } catch {
 // If page count fails, fall through; render still attempts.
 }

 const images = await renderPDFPagesToImages(file, 10, 150);
  // (vector text extraction removed — the v2 pipeline does its own grounding server-side.)
 // Keep file/page provenance on each image so we can pass an image_manifest to the AI
 // and validate page_index round-trips correctly.
 const baseIndex = allImages.length;
 allImages.push(
 ...images.map((img, idx) => ({
 ...img,
 pageIndex: baseIndex + idx,
 fileIndex: fi,
 fileName,
 pageInFile: idx + 1,
 }))
 );
  setRenderProgress(((fi + 1) / r.file_urls.length) * 100);
  }
  setPageImages(allImages);
 setPageCapInfo({ total: totalSheetsAcrossFiles, rendered: renderedSheetsAcrossFiles });
 return allImages;
 } catch {
 return [];
 } finally {
 setRenderingPages(false);
 }
 };

  // ── runAICheck + renderVisionImages removed ──
  // The v1 in-page AI runner has been retired. The v2 pipeline (run-review-pipeline
  // edge function) is now the sole writer of deficiencies_v2 and is launched from
  // the /dashboard route. The "Run AI Check" buttons in this page route the user
  // there. See plan #2 / Wave 2 cleanup.

  const createNewRound = () => {
    // New rounds belong on the v2 dashboard so deficiencies_v2 carries forward
    // correctly. The dashboard owns the only writer of pipeline output.
    if (!review) return;
    navigate(`/plan-review/${review.id}/dashboard`);
  };

 const generateCommentLetter = async (r: PlanReviewRow) => {
 // Abort any in-flight letter generation before starting a new one.
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
          // Comment letter is generated from the verified, dedup'd v2 findings.
          findings: v2Findings ?? [],
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

 const handleLocateFinding = useCallback(async (index: number) => {
 setActiveFindingIndex(index);
 if (pageImages.length === 0 && review && review.file_urls.length > 0) {
 await renderDocumentPages(review);
 }
 }, [pageImages.length, review]);

 // ── Reviewer keyboard shortcuts (global to the page) ───────────────────
 // J / K — next / prev finding
 // R — reposition active pin
 // S — mark resolved
 // X — mark deferred
 // O — mark open
 // Skip when typing in inputs/textareas; the viewer handles its own arrows/+/-/0.
 useEffect(() => {
 const handler = (e: KeyboardEvent) => {
 const tag = (e.target as HTMLElement)?.tagName;
 if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
 if (e.metaKey || e.ctrlKey || e.altKey) return;
      const findingsList = v2Findings ?? [];
      if (findingsList.length === 0) return;

 const cur = activeFindingIndex;
 const last = findingsList.length - 1;

 switch (e.key.toLowerCase()) {
 case "j": {
 e.preventDefault();
 const next = cur === null ? 0 : Math.min(last, cur + 1);
 setActiveFindingIndex(next);
 break;
 }
 case "k": {
 e.preventDefault();
 const prev = cur === null ? 0 : Math.max(0, cur - 1);
 setActiveFindingIndex(prev);
 break;
 }
 case "r": {
 if (cur !== null && findingsList[cur]?.markup) {
 e.preventDefault();
 setRepositioningIndex(cur);
 }
 break;
 }
 case "s": {
 if (cur !== null) { e.preventDefault(); updateFindingStatus(cur, "resolved"); }
 break;
 }
 case "x": {
 if (cur !== null) { e.preventDefault(); updateFindingStatus(cur, "deferred"); }
 break;
 }
  case "o": {
   if (cur !== null) { e.preventDefault(); updateFindingStatus(cur, "open"); }
   break;
  }
  case "?": {
   e.preventDefault();
   setShowShortcuts((s) => !s);
   break;
  }
  case "escape": {
   if (showShortcuts) { e.preventDefault(); setShowShortcuts(false); }
   break;
  }
  }
 };
 window.addEventListener("keydown", handler);
 return () => window.removeEventListener("keydown", handler);
 }, [activeFindingIndex, review, v2Findings, updateFindingStatus]);

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

  // All findings come from deficiencies_v2 via the adapter. While the query is
  // loading we render an empty list (skeleton-equivalent) so the page doesn't
  // flash old data.
  const findings = v2Findings ?? [];
 const previousFindings = (review.previous_findings as Finding[]) || [];
 const groupedFindings = groupFindingsByDiscipline(findings);
 const county = review.project?.county || "";
 const hvhz = isHVHZ(county);
 const fileUrls = review.file_urls || [];
 
 const contractor = review.project?.contractor || null;

 // Compose all four filter dimensions: status × confidence × discipline × sheet.
 const filteredFindings = findings.filter((f, i) => {
 if (statusFilter !== "all" && (findingStatuses[i] || "open") !== statusFilter) return false;
 if (confidenceFilter !== "all" && (f.markup?.pin_confidence || "low") !== confidenceFilter) return false;
 if (disciplineFilter !== "all" && (f.discipline || "structural") !== disciplineFilter) return false;
 if (sheetFilter !== "all" && (f.page || "Unknown").trim() !== sheetFilter) return false;
 return true;
 });
 const filteredGrouped = groupFindingsByDiscipline(filteredFindings);

 // Compute counts for the filter chip strip (always against the full result set).
 const confidenceCounts: Record<ConfidenceFilter, number> = {
 all: findings.length,
 high: findings.filter((f) => (f.markup?.pin_confidence || "low") === "high").length,
 medium: findings.filter((f) => (f.markup?.pin_confidence || "low") === "medium").length,
 low: findings.filter((f) => (f.markup?.pin_confidence || "low") === "low").length,
 };
 const disciplinesPresent = Array.from(new Set(findings.map((f) => f.discipline || "structural")))
 .sort((a, b) => DISCIPLINE_ORDER.indexOf(a as typeof DISCIPLINE_ORDER[number]) - DISCIPLINE_ORDER.indexOf(b as typeof DISCIPLINE_ORDER[number]));
 const sheetsPresent = Array.from(new Set(findings.map((f) => (f.page || "Unknown").trim()))).sort();

 // Bulk-resolve helpers: act on the currently visible (filtered) result set.
 const visibleIndices = findings.reduce<number[]>((acc, f, i) => {
 if (filteredFindings.includes(f)) acc.push(i);
 return acc;
 }, []);
 const allVisibleResolved = visibleIndices.length > 0 && visibleIndices.every((i) => findingStatuses[i] === "resolved");
 const handleMarkVisibleResolved = () => {
 if (visibleIndices.length === 0) return;
 visibleIndices.forEach((i) => {
 if (findingStatuses[i] !== "resolved") updateFindingStatus(i, "resolved");
 });
 toast.success(`Marked ${visibleIndices.length} finding${visibleIndices.length === 1 ? "" : "s"} resolved`);
 };

 const criticalCount = findings.filter((f) => f.severity === "critical").length;
 const majorCount = findings.filter((f) => f.severity === "major").length;
 const minorCount = findings.filter((f) => f.severity === "minor").length;
 const openCount = findings.filter((_, i) => !findingStatuses[i] || findingStatuses[i] === "open").length;
 const resolvedCount = findings.filter((_, i) => findingStatuses[i] === "resolved").length;
 const deferredCount = findings.filter((_, i) => findingStatuses[i] === "deferred").length;
 const daysLeft = getDaysRemaining(review.created_at);

 let globalIndexCounter = 0;
 const globalIndexMap = new Map<Finding, number>();
 for (const d of DISCIPLINE_ORDER) {
 if (!groupedFindings[d]) continue;
 for (const f of groupedFindings[d]) {
 globalIndexMap.set(f, globalIndexCounter++);
 }
 }

 // Per-finding diff classification (for the inline dot beside each card).
 const diffMap = new Map<number, "new" | "carried">();
 // Roll-up counts for the round-comparison header. Match key is `code_ref|page`.
 const findingKey = (f: Finding) => `${(f.code_ref || "").trim().toLowerCase()}|${(f.page || "").trim().toLowerCase()}`;
 let newCount = 0;
 let persistedCount = 0;
 let newlyResolvedCount = 0;
 if (review.round > 1 && previousFindings.length > 0) {
 const prevKeys = new Set(previousFindings.map(findingKey));
 const currKeys = new Set(findings.map(findingKey));
 for (let i = 0; i < findings.length; i++) {
 const k = findingKey(findings[i]);
 if (prevKeys.has(k)) {
 diffMap.set(i, "carried");
 persistedCount++;
 } else {
 diffMap.set(i, "new");
 newCount++;
 }
 }
 for (const pk of prevKeys) {
 if (!currKeys.has(pk)) newlyResolvedCount++;
 }
 }
 const hasRoundDiff = review.round > 1 && previousFindings.length > 0;

 const projectRounds = (allRounds || []).map((r) => ({
 id: r.id,
 round: r.round,
 created_at: r.created_at,
 ai_check_status: r.ai_check_status,
 findingsCount: r.findings_count || 0,
 }));

 const hasDocuments = fileUrls.length > 0;
 const hasFindings = findings.length > 0;

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
        onRunAICheck={() => navigate(`/plan-review/${review.id}/dashboard`)}
        onNavigateRound={(rid) => navigate(`/plan-review/${rid}`)}
        onNewRound={createNewRound}
      />

      {/* ── Page-cap banner: surface silent 10-page truncation honestly ── */}
      {pageCapInfo && pageCapInfo.total > pageCapInfo.rendered && (
        <div className="shrink-0 border-b bg-warning/10 px-4 py-1.5 flex items-center gap-2">
          <span className="text-2xs font-semibold text-warning uppercase tracking-wide">Limited review</span>
          <span className="text-xs text-foreground/80">
            Reviewing the first <strong>{pageCapInfo.rendered}</strong> of <strong>{pageCapInfo.total}</strong> sheet{pageCapInfo.total !== 1 ? "s" : ""}.
            Findings on later sheets cannot be detected by AI in this round.
          </span>
        </div>
      )}

 {/* ── Main Split Layout ── */}
 {isMobile ? (
 /* ── Mobile: Tab Switcher ── */
 <div className="flex-1 flex flex-col overflow-hidden">
 <div className="shrink-0 border-b bg-card px-3 py-1.5 flex gap-1">
 <button
 onClick={() => setMobileTab("plans")}
 className={cn("px-4 py-1.5 rounded-md text-xs font-medium transition-all", mobileTab === "plans" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted/50")}
 >
 Plan Sheet
 </button>
 <button
 onClick={() => setMobileTab("findings")}
 className={cn("px-4 py-1.5 rounded-md text-xs font-medium transition-all", mobileTab === "findings" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted/50")}
 >
 Findings {hasFindings && <span className="ml-1 text-caption opacity-70">{findings.length}</span>}
 </button>
 </div>
 {mobileTab === "plans" ? (
 <div className="flex-1 flex flex-col min-w-0">
 {hasDocuments ? (
 <>
 {renderingPages && pageImages.length === 0 && (
 <div className="flex-1 flex items-center justify-center">
 <div className="text-center space-y-3">
 <Loader2 className="h-8 w-8 text-accent mx-auto animate-spin" />
 <p className="text-sm text-muted-foreground">Loading document...</p>
 <Progress value={renderProgress} className="h-1 w-48 mx-auto" />
 </div>
 </div>
 )}
 {pageImages.length > 0 && (
 <PlanMarkupViewer pageImages={pageImages} findings={findings} activeFindingIndex={activeFindingIndex} onAnnotationClick={handleAnnotationClick} className="flex-1" />
 )}
 </>
 ) : (
 <div className="flex-1 flex items-center justify-center p-6">
 <div className="border-2 border-dashed border-border/50 rounded-xl p-8 text-center cursor-pointer hover:border-accent/40 transition-all" onClick={() => fileInputRef.current?.click()}>
 {uploading ? <Loader2 className="h-8 w-8 text-accent mx-auto mb-2 animate-spin" /> : <Upload className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />}
 <p className="text-sm font-medium">{uploading ? "Uploading..." : "Drop plans here"}</p>
 <p className="text-xs text-muted-foreground mt-1">PDF up to 20MB</p>
 <input ref={fileInputRef} type="file" accept=".pdf" multiple className="hidden" onChange={(e) => handleFileUpload(e.target.files)} />
 </div>
 </div>
 )}
 </div>
 ) : (
 <div className="flex-1 overflow-y-auto bg-card">
 <div className="shrink-0 px-3 py-2 border-b flex items-center gap-1 overflow-x-auto">
 <RightPanelTabs active={rightPanel} onChange={setRightPanel} findingsCount={hasFindings ? findings.length : undefined} />
 </div>
 <div className="overflow-y-auto">
 {rightPanel === "findings" && (
 <div className="p-3 space-y-2">
  {!hasFindings && (
  <div className="flex flex-col items-center justify-center py-12 px-4">
  {hasDocuments ? (
  <div className="text-center space-y-3 max-w-[220px]">
  <div className="mx-auto w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center"><Sparkles className="h-5 w-5 text-accent" /></div>
  <p className="text-sm font-medium">Ready to analyze</p>
  <Button size="sm" onClick={() => navigate(`/plan-review/${review.id}/dashboard`)} className="w-full"><Sparkles className="h-3.5 w-3.5 mr-1.5" /> Open Dashboard</Button>
 </div>
 ) : (
 <div className="text-center space-y-2"><Upload className="h-8 w-8 text-muted-foreground/20 mx-auto" /><p className="text-sm text-muted-foreground">Upload documents to begin</p></div>
 )}
 </div>
 )}
 {hasFindings && (
 <>
 <FindingStatusFilter activeFilter={statusFilter} counts={{ all: findings.length, open: openCount, resolved: resolvedCount, deferred: deferredCount }} onFilterChange={setStatusFilter} />
 <Accordion type="multiple" defaultValue={DISCIPLINE_ORDER.filter((d) => filteredGrouped[d])} className="space-y-1">
 {DISCIPLINE_ORDER.filter((d) => filteredGrouped[d]).map((discipline) => {
 const group = filteredGrouped[discipline];
 const Icon = getDisciplineIcon(discipline);
 const worst = getWorstSeverity(group);
 return (
 <AccordionItem key={discipline} value={discipline} className="border rounded-lg overflow-hidden">
 <AccordionTrigger className="px-3 py-2 hover:no-underline hover:bg-muted/30 text-xs">
 <div className="flex items-center gap-2">
 <Icon className={cn("h-3.5 w-3.5", getDisciplineColor(discipline))} />
 <span className="font-medium">{getDisciplineLabel(discipline)}</span>
 <Badge variant="secondary" className="text-caption h-4 px-1">{group.length}</Badge>
 </div>
 </AccordionTrigger>
 <AccordionContent className="px-3 pb-3 space-y-1.5">
 {group.map((finding, i) => {
 const gi = globalIndexMap.get(finding)!;
 return (
 <FindingCard key={i} ref={(el) => { if (el) findingRefs.current.set(gi, el); }} finding={finding} index={i} globalIndex={gi} isActive={activeFindingIndex === gi} onLocateClick={() => { handleLocateFinding(gi); setMobileTab("plans"); }} onRepositionClick={() => { setRepositioningIndex(gi); setMobileTab("plans"); }} animationDelay={i * 40} status={findingStatuses[gi] || "open"} onStatusChange={(status) => updateFindingStatus(gi, status)} history={(findingHistory || []).filter(h => h.finding_index === gi)} />
 );
 })}
 </AccordionContent>
 </AccordionItem>
 );
 })}
 </Accordion>
 </>
 )}
 </div>
 )}
 {rightPanel === "checklist" && <div className="p-3"><DisciplineChecklist tradeType={review.project?.trade_type || "building"} findings={findings} /></div>}
 {rightPanel === "completeness" && <div className="p-3"><SitePlanChecklist findings={findings} county={county} /></div>}
 {rightPanel === "letter" && (
 <LetterPanel reviewId={review.id} projectId={review.project_id} projectName={review.project?.name || ""} address={review.project?.address || ""} county={county} jurisdiction={review.project?.jurisdiction || ""} tradeType={review.project?.trade_type || ""} round={review.round} aiCheckStatus={review.ai_check_status} qcStatus={review.qc_status || "pending_qc"} hasFindings={hasFindings} findings={findings} findingStatuses={findingStatuses} firmSettings={firmSettings} commentLetter={commentLetter} generatingLetter={generatingLetter} copied={copied} userId={user?.id} autosaveState={autosaveState} autosaveLastSavedAt={lastSavedAt} onGenerateLetter={async () => { if (commentLetter && !(await confirm({ title: "Regenerate letter?", description: "This replaces the current draft. Your edits will be lost.", confirmLabel: "Regenerate", variant: "destructive", rememberKey: "regen-letter" }))) return; generateCommentLetter(review); }} onCancelLetter={cancelCommentLetter} onCopyLetter={copyLetter} onLetterChange={setCommentLetter} onSendToContractor={() => { const issues = lintCommentLetter(commentLetter, findings, findingStatuses); setLintIssues(issues); setShowLintDialog(true); }} onQcApprove={async () => { await supabase.from("plan_reviews").update({ qc_status: "qc_approved", qc_reviewer_id: user?.id }).eq("id", review.id); queryClient.invalidateQueries({ queryKey: ["plan-review", id] }); toast.success("QC approved"); }} onQcReject={async () => { await supabase.from("plan_reviews").update({ qc_status: "qc_rejected", qc_reviewer_id: user?.id }).eq("id", review.id); queryClient.invalidateQueries({ queryKey: ["plan-review", id] }); toast.error("QC rejected"); }} onDocumentGenerated={() => queryClient.invalidateQueries({ queryKey: ["project-documents", review.project_id] })} />
 )}
 {rightPanel === "county" && <CountyPanel county={county} />}
 </div>
 </div>
 )}
 </div>
 ) : (
 <ResizablePanelGroup direction="horizontal" className="flex-1 overflow-hidden">
 {/* ── LEFT: Document Viewer ── */}
 <ResizablePanel defaultSize={rightPanelCollapsed ? 100 : 65} minSize={35}>
 <div className="h-full flex flex-col min-w-0">
 {hasDocuments ? (
 <>
 {renderingPages && pageImages.length === 0 && (
 <div className="flex-1 flex items-center justify-center">
 <div className="text-center space-y-3">
 <Loader2 className="h-8 w-8 text-accent mx-auto animate-spin" />
 <p className="text-sm text-muted-foreground">Loading document...</p>
 <Progress value={renderProgress} className="h-1 w-48 mx-auto" />
 </div>
 </div>
 )}
 {pageImages.length > 0 && (
 <PlanMarkupViewer
 pageImages={pageImages}
 findings={findings}
 activeFindingIndex={activeFindingIndex}
 onAnnotationClick={handleAnnotationClick}
 repositioningIndex={repositioningIndex}
 onRepositionConfirm={handleRepositionConfirm}
 onRepositionCancel={() => setRepositioningIndex(null)}
 className="flex-1"
 />
 )}
 <div className="shrink-0 border-t bg-muted/20 px-3 py-1.5 flex items-center gap-2 overflow-x-auto">
 {uploadSuccess && (
 <span className="flex items-center gap-1 text-2xs text-success font-medium animate-in fade-in">
 <Check className="h-3 w-3" /> Uploaded
 </span>
 )}
 {fileUrls.map((url, i) => {
 const name = decodeURIComponent(url.split("/").pop() || `Doc ${i + 1}`);
 return (
 <span key={i} className="text-2xs text-muted-foreground bg-muted px-2 py-0.5 rounded truncate max-w-[200px]">
 {name}
 </span>
 );
 })}
 <button className="text-2xs text-accent hover:text-accent/80 transition-colors shrink-0" onClick={() => fileInputRef.current?.click()}>
 + Add file
 </button>
 <input ref={fileInputRef} type="file" accept=".pdf" multiple className="hidden" onChange={(e) => handleFileUpload(e.target.files)} />
 </div>
 </>
 ) : (
 <div className="flex-1 flex items-center justify-center">
 <div
 className="border-2 border-dashed border-border/50 rounded-xl p-12 text-center cursor-pointer hover:border-accent/40 hover:bg-accent/5 transition-all max-w-md"
 onClick={() => fileInputRef.current?.click()}
 onDragOver={(e) => e.preventDefault()}
 onDrop={(e) => { e.preventDefault(); handleFileUpload(e.dataTransfer.files); }}
 >
 {uploading ? (
 <Loader2 className="h-10 w-10 text-accent mx-auto mb-3 animate-spin" />
 ) : (
 <Upload className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
 )}
 <p className="text-sm font-medium text-foreground">{uploading ? "Uploading..." : "Drop plan documents here"}</p>
 <p className="text-xs text-muted-foreground mt-1">PDF files up to 20MB</p>
 <input ref={fileInputRef} type="file" accept=".pdf" multiple className="hidden" onChange={(e) => handleFileUpload(e.target.files)} />
 </div>
 </div>
 )}
 </div>
 </ResizablePanel>

 {!rightPanelCollapsed && <ResizableHandle withHandle />}

 {rightPanelCollapsed && (
 <div className="w-10 shrink-0 border-l bg-card flex flex-col items-center py-2 gap-2">
 <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setRightPanelCollapsed(false)} title="Expand panel">
 <PanelRight className="h-3.5 w-3.5" />
 </Button>
 {hasFindings && (
 <span className="text-caption font-semibold text-muted-foreground" style={{ writingMode: "vertical-rl" }}>
 {findings.length} findings
 </span>
 )}
 </div>
 )}

 {!rightPanelCollapsed && (
 <ResizablePanel defaultSize={35} minSize={20} maxSize={55}>
 <div className="h-full flex flex-col overflow-hidden bg-card">
 <div className="shrink-0 px-3 py-2 border-b flex items-center gap-1">
 <Button size="icon" variant="ghost" className="h-6 w-6 mr-1" onClick={() => setRightPanelCollapsed(true)} title="Collapse panel">
 <PanelRightClose className="h-3.5 w-3.5" />
 </Button>
 <RightPanelTabs active={rightPanel} onChange={setRightPanel} findingsCount={hasFindings ? findings.length : undefined} />
 {hasFindings && rightPanel === "findings" && (
 <div className="ml-auto flex items-center gap-1.5">
 <SeverityDonut critical={criticalCount} major={majorCount} minor={minorCount} size={24} />
 <span className="text-2xs text-muted-foreground">{openCount} open</span>
 </div>
 )}
 </div>

 <div className="flex-1 overflow-y-auto">
 {rightPanel === "findings" && (
 <div className="p-3 space-y-2">
  {!hasFindings && (
  <div className="flex flex-col items-center justify-center py-12 px-4">
  {hasDocuments ? (
  <div className="text-center space-y-3 max-w-[220px]">
  <div className="mx-auto w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
  <Sparkles className="h-5 w-5 text-accent" />
  </div>
  <p className="text-sm font-medium">Ready to analyze</p>
  <p className="text-xs text-muted-foreground">{fileUrls.length} document{fileUrls.length > 1 ? "s" : ""} loaded</p>
  <Button
  size="sm"
  onClick={() => navigate(`/plan-review/${review.id}/dashboard`)}
  className="w-full"
  >
  <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Open Dashboard
  </Button>
 </div>
 ) : (
 <div className="text-center space-y-2">
 <Upload className="h-8 w-8 text-muted-foreground/20 mx-auto" />
 <p className="text-sm text-muted-foreground">Upload documents to begin</p>
 </div>
 )}
 </div>
 )}
 {hasFindings && (
 <>
 <BulkTriageFilters
 statusCounts={{ all: findings.length, open: openCount, resolved: resolvedCount, deferred: deferredCount }}
 statusFilter={statusFilter}
 onStatusFilterChange={setStatusFilter}
 confidenceCounts={confidenceCounts}
 confidenceFilter={confidenceFilter}
 onConfidenceFilterChange={setConfidenceFilter}
 disciplines={disciplinesPresent}
 disciplineFilter={disciplineFilter}
 onDisciplineFilterChange={setDisciplineFilter}
 sheets={sheetsPresent}
 sheetFilter={sheetFilter}
 onSheetFilterChange={setSheetFilter}
 visibleCount={filteredFindings.length}
 allVisibleResolved={allVisibleResolved}
 onMarkVisibleResolved={handleMarkVisibleResolved}
 />
 {hasRoundDiff && (
 <div className="rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1.5 flex items-center gap-3 text-2xs">
 <span className="font-semibold text-accent uppercase tracking-wide">Round {review.round} vs R{review.round - 1}</span>
 <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-accent" /> <strong>{newCount}</strong> new</span>
 <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" /> <strong>{persistedCount}</strong> persisted</span>
 <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-success" /> <strong>{newlyResolvedCount}</strong> resolved since R{review.round - 1}</span>
 </div>
 )}
 <Accordion type="multiple" defaultValue={DISCIPLINE_ORDER.filter((d) => filteredGrouped[d])} className="space-y-1">
 {DISCIPLINE_ORDER.filter((d) => filteredGrouped[d]).map((discipline) => {
 const group = filteredGrouped[discipline];
 const Icon = getDisciplineIcon(discipline);
 const worst = getWorstSeverity(group);
 return (
 <AccordionItem key={discipline} value={discipline} className="border rounded-lg overflow-hidden">
 <AccordionTrigger className="px-3 py-2 hover:no-underline hover:bg-muted/30 text-xs">
 <div className="flex items-center gap-2">
 <Icon className={cn("h-3.5 w-3.5", getDisciplineColor(discipline))} />
 <span className="font-medium">{getDisciplineLabel(discipline)}</span>
 <Badge variant="secondary" className="text-[9px] h-4 px-1">{group.length}</Badge>
 <div className={cn("h-1.5 w-1.5 rounded-full", {
 "bg-destructive": worst === "critical",
 "bg-warning": worst === "major",
 "bg-muted-foreground/40": worst === "minor",
 })} />
 </div>
 </AccordionTrigger>
 <AccordionContent className="px-3 pb-3 space-y-1.5">
 {group.map((finding, i) => {
 const gi = globalIndexMap.get(finding)!;
 const diffStatus = diffMap.get(gi);
 return (
 <div key={i} className="relative">
 {hasRoundDiff && diffStatus && (
 <div className={cn(
 "absolute -left-2 top-1/2 -translate-y-1/2 w-1 h-1 rounded-full z-10",
 diffStatus === "new" ? "bg-accent" : "bg-muted-foreground/40"
 )} />
 )}
 <FindingCard
 ref={(el) => { if (el) findingRefs.current.set(gi, el); }}
 finding={finding}
 index={i}
 globalIndex={gi}
 isActive={activeFindingIndex === gi}
 onLocateClick={() => handleLocateFinding(gi)}
 onRepositionClick={() => setRepositioningIndex(gi)}
 animationDelay={i * 40}
 status={findingStatuses[gi] || "open"}
 onStatusChange={(status) => updateFindingStatus(gi, status)}
 history={(findingHistory || []).filter(h => h.finding_index === gi)}
 />
 </div>
 );
 })}
 </AccordionContent>
 </AccordionItem>
 );
 })}
 </Accordion>
 </>
 )}
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

 {rightPanel === "letter" && (
 <LetterPanel
 reviewId={review.id}
 projectId={review.project_id}
 projectName={review.project?.name || ""}
 address={review.project?.address || ""}
 county={county}
 jurisdiction={review.project?.jurisdiction || ""}
 tradeType={review.project?.trade_type || ""}
 round={review.round}
 aiCheckStatus={review.ai_check_status}
 qcStatus={review.qc_status || "pending_qc"}
 hasFindings={hasFindings}
 findings={findings}
 findingStatuses={findingStatuses}
 firmSettings={firmSettings}
  commentLetter={commentLetter}
 generatingLetter={generatingLetter}
 copied={copied}
 userId={user?.id}
 autosaveState={autosaveState}
 autosaveLastSavedAt={lastSavedAt}
 onGenerateLetter={async () => {
  if (commentLetter && !(await confirm({ title: "Regenerate letter?", description: "This replaces the current draft. Your edits will be lost.", confirmLabel: "Regenerate", variant: "destructive", rememberKey: "regen-letter" }))) return;
  generateCommentLetter(review);
 }}
 onCancelLetter={cancelCommentLetter}
 onCopyLetter={copyLetter}
 onLetterChange={setCommentLetter}
 onSendToContractor={() => {
  const issues = lintCommentLetter(commentLetter, findings, findingStatuses);
  setLintIssues(issues);
  setShowLintDialog(true);
 }}
 onQcApprove={async () => {
 // FS 553.791 sign-off integrity: a reviewer cannot QC their own work.
 if (review.reviewer_id && review.reviewer_id === user?.id) {
 toast.error("You ran this review — a different team member must approve QC.");
 return;
 }
 await supabase.from("plan_reviews").update({ qc_status: "qc_approved", qc_reviewer_id: user?.id }).eq("id", review.id);
 await supabase.from("activity_log").insert({ event_type: "qc_approved", description: "Plan review QC approved", project_id: review.project_id, actor_id: user?.id, actor_type: "user" });
 queryClient.invalidateQueries({ queryKey: ["plan-review", id] });
 toast.success("QC approved — exports unlocked");
 }}
 onQcReject={async () => {
 await supabase.from("plan_reviews").update({ qc_status: "qc_rejected", qc_reviewer_id: user?.id }).eq("id", review.id);
 await supabase.from("activity_log").insert({ event_type: "qc_rejected", description: "Plan review QC rejected", project_id: review.project_id, actor_id: user?.id, actor_type: "user" });
 queryClient.invalidateQueries({ queryKey: ["plan-review", id] });
 toast.error("QC rejected");
 }}
 onDocumentGenerated={() => queryClient.invalidateQueries({ queryKey: ["project-documents", review.project_id] })}
 />
 )}

 {rightPanel === "county" && (
 <CountyPanel county={county} />
 )}
 </div>
 </div>
 </ResizablePanel>
 )}
 </ResizablePanelGroup>
 )}
 </div>
 );
}
