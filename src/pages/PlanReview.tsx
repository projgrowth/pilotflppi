import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { callAI, streamAI } from "@/lib/ai";
import { renderPDFPagesToImages, type PDFPageImage } from "@/lib/pdf-utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FileSearch, Sparkles, Send, Loader2, ChevronRight, Copy, Check,
  Wind, Upload, FileText, X, Plus, Eye, ClipboardCheck
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { FindingCard, type Finding } from "@/components/FindingCard";
import { NewPlanReviewWizard } from "@/components/NewPlanReviewWizard";
import { SeverityDonut } from "@/components/SeverityDonut";
import { ScanTimeline } from "@/components/ScanTimeline";
import { PlanMarkupViewer } from "@/components/PlanMarkupViewer";
import { DeadlineRing } from "@/components/DeadlineRing";
import { FindingStatusFilter, type FindingStatus } from "@/components/FindingStatusFilter";
import { RoundNavigator } from "@/components/RoundNavigator";
import { DisciplineChecklist } from "@/components/DisciplineChecklist";
import { CommentLetterExport } from "@/components/CommentLetterExport";
import {
  isHVHZ, getCountyLabel, getDisciplineIcon, getDisciplineColor,
  getDisciplineLabel, DISCIPLINE_ORDER, SCANNING_STEPS,
} from "@/lib/county-utils";

interface PlanReviewRow {
  id: string;
  project_id: string;
  ai_check_status: string;
  ai_findings: unknown;
  file_urls: string[];
  round: number;
  created_at: string;
  finding_statuses?: Record<string, string> | null;
  previous_findings?: unknown;
  project?: { id: string; name: string; address: string; trade_type: string; county: string; jurisdiction: string } | null;
}

function usePlanReviews() {
  return useQuery({
    queryKey: ["plan-reviews"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plan_reviews")
        .select("*, project:projects(id, name, address, trade_type, county, jurisdiction)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as PlanReviewRow[];
    },
  });
}

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

function hasCriticalFindings(review: PlanReviewRow): boolean {
  const findings = review.ai_findings as Finding[] | null;
  return Array.isArray(findings) && findings.some((f) => f.severity === "critical");
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: Error | null = null;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (i < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, Math.pow(2, i) * 1000));
      }
    }
  }
  throw lastError;
}

function getDaysRemaining(createdAt: string): number {
  const deadline = new Date(createdAt);
  deadline.setDate(deadline.getDate() + 21);
  const now = new Date();
  return Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
}

const severityColors: Record<string, string> = {
  critical: "bg-destructive text-destructive-foreground",
  major: "bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))]",
  minor: "bg-muted text-muted-foreground",
};

export default function PlanReview() {
  const { data: reviews, isLoading } = usePlanReviews();
  const queryClient = useQueryClient();
  const [selectedReview, setSelectedReview] = useState<PlanReviewRow | null>(null);
  const [aiRunning, setAiRunning] = useState(false);
  const [scanStep, setScanStep] = useState(0);
  const [commentLetter, setCommentLetter] = useState("");
  const [generatingLetter, setGeneratingLetter] = useState(false);
  const [copied, setCopied] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [activeFindingIndex, setActiveFindingIndex] = useState<number | null>(null);
  const [pageImages, setPageImages] = useState<PDFPageImage[]>([]);
  const [renderingPages, setRenderingPages] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const findingRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // New state for features
  const [findingStatuses, setFindingStatuses] = useState<Record<number, FindingStatus>>({});
  const [statusFilter, setStatusFilter] = useState<FindingStatus | "all">("all");
  const [showDiff, setShowDiff] = useState(false);

  // Load finding statuses from DB when review selected
  useEffect(() => {
    if (selectedReview?.finding_statuses) {
      const loaded: Record<number, FindingStatus> = {};
      for (const [k, v] of Object.entries(selectedReview.finding_statuses as Record<string, string>)) {
        loaded[Number(k)] = v as FindingStatus;
      }
      setFindingStatuses(loaded);
    } else {
      setFindingStatuses({});
    }
  }, [selectedReview?.id]);

  // Persist finding statuses to DB (debounced)
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
      const next = { ...prev, [index]: status };
      if (selectedReview) persistFindingStatuses(selectedReview.id, next);
      return next;
    });
  }, [selectedReview, persistFindingStatuses]);

  const handleWizardComplete = useCallback((reviewId: string) => {
    queryClient.invalidateQueries({ queryKey: ["plan-reviews"] });
    setTimeout(async () => {
      const { data } = await supabase
        .from("plan_reviews")
        .select("*, project:projects(id, name, address, trade_type, county, jurisdiction)")
        .eq("id", reviewId)
        .single();
      if (data) {
        setSelectedReview(data as PlanReviewRow);
        setActiveTab("overview");
      }
    }, 500);
  }, [queryClient]);

  useEffect(() => {
    if (!aiRunning) { setScanStep(0); return; }
    const interval = setInterval(() => {
      setScanStep((s) => (s + 1) % SCANNING_STEPS.length);
    }, 1800);
    return () => clearInterval(interval);
  }, [aiRunning]);

  const totalReviews = reviews?.length || 0;
  const completedReviews = reviews?.filter((r) => r.ai_check_status === "complete").length || 0;
  const totalFindings = reviews?.reduce((sum, r) => sum + (Array.isArray(r.ai_findings) ? (r.ai_findings as Finding[]).length : 0), 0) || 0;

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || !selectedReview) return;
    setUploading(true);
    try {
      const newUrls: string[] = [...(selectedReview.file_urls || [])];
      for (const file of Array.from(files)) {
        if (file.type !== "application/pdf") { toast.error(`${file.name} is not a PDF`); continue; }
        if (file.size > 20 * 1024 * 1024) { toast.error(`${file.name} exceeds 20MB limit`); continue; }
        const path = `plan-reviews/${selectedReview.id}/${file.name}`;
        const { error: uploadError } = await supabase.storage.from("documents").upload(path, file, { upsert: true });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from("documents").getPublicUrl(path);
        newUrls.push(urlData.publicUrl);
      }
      await supabase.from("plan_reviews").update({ file_urls: newUrls }).eq("id", selectedReview.id);
      setSelectedReview({ ...selectedReview, file_urls: newUrls });
      queryClient.invalidateQueries({ queryKey: ["plan-reviews"] });
      toast.success("Documents uploaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const removeFile = async (urlToRemove: string) => {
    if (!selectedReview) return;
    const newUrls = (selectedReview.file_urls || []).filter((u) => u !== urlToRemove);
    await supabase.from("plan_reviews").update({ file_urls: newUrls }).eq("id", selectedReview.id);
    setSelectedReview({ ...selectedReview, file_urls: newUrls });
    queryClient.invalidateQueries({ queryKey: ["plan-reviews"] });
  };

  const renderDocumentPages = async (review: PlanReviewRow): Promise<PDFPageImage[]> => {
    if (!review.file_urls || review.file_urls.length === 0) return [];
    setRenderingPages(true);
    setRenderProgress(0);
    try {
      const allImages: PDFPageImage[] = [];
      for (let fi = 0; fi < review.file_urls.length; fi++) {
        const url = review.file_urls[fi];
        const response = await fetch(url);
        const blob = await response.blob();
        const file = new File([blob], `doc-${fi}.pdf`, { type: "application/pdf" });
        const images = await renderPDFPagesToImages(file, 10, 150);
        allImages.push(...images.map((img, idx) => ({ ...img, pageIndex: allImages.length + idx })));
        setRenderProgress(((fi + 1) / review.file_urls.length) * 100);
      }
      setPageImages(allImages);
      return allImages;
    } catch (err) {
      console.error("Failed to render pages:", err);
      return [];
    } finally {
      setRenderingPages(false);
    }
  };

  const runAICheck = async (review: PlanReviewRow) => {
    setAiRunning(true);
    setActiveTab("findings");
    setActiveFindingIndex(null);
    try {
      await supabase.from("plan_reviews").update({ ai_check_status: "running" }).eq("id", review.id);
      queryClient.invalidateQueries({ queryKey: ["plan-reviews"] });

      let findings: Finding[] = [];
      const hasFiles = review.file_urls && review.file_urls.length > 0;

      if (hasFiles) {
        const images = await renderDocumentPages(review);
        if (images.length > 0) {
          const result = await withRetry(() =>
            callAI({
              action: "plan_review_check_visual",
              payload: {
                project_name: review.project?.name,
                address: review.project?.address,
                trade_type: review.project?.trade_type,
                county: review.project?.county,
                jurisdiction: review.project?.jurisdiction,
                round: review.round,
                images: images.map((img) => img.base64),
              },
            })
          );
          try {
            findings = JSON.parse(result);
            if (!Array.isArray(findings)) {
              const match = result.match(/\[[\s\S]*\]/);
              findings = match ? JSON.parse(match[0]) : [];
            }
          } catch {
            try {
              const match = result.match(/\[[\s\S]*\]/);
              if (match) findings = JSON.parse(match[0]);
            } catch { /* fallback below */ }
          }
        }
      }

      if (findings.length === 0) {
        const payload: Record<string, unknown> = {
          project_name: review.project?.name,
          address: review.project?.address,
          trade_type: review.project?.trade_type,
          county: review.project?.county,
          jurisdiction: review.project?.jurisdiction,
          round: review.round,
        };
        if (hasFiles) {
          payload.document_context = `Plans attached: ${review.file_urls.map((u) => decodeURIComponent(u.split("/").pop() || "")).join(", ")}`;
        }
        const result = await withRetry(() => callAI({ action: "plan_review_check", payload }));
        try {
          findings = JSON.parse(result);
          if (!Array.isArray(findings)) {
            const match = result.match(/\[[\s\S]*\]/);
            findings = match ? JSON.parse(match[0]) : [];
          }
        } catch {
          try {
            const match = result.match(/\[[\s\S]*\]/);
            if (match) findings = JSON.parse(match[0]);
          } catch { findings = []; }
        }
      }

      // Store previous findings for diff
      const prevFindings = review.ai_findings || [];

      await supabase.from("plan_reviews").update({
        ai_check_status: "complete",
        ai_findings: JSON.parse(JSON.stringify(findings)),
        previous_findings: JSON.parse(JSON.stringify(prevFindings)),
        finding_statuses: {},
      }).eq("id", review.id);

      queryClient.invalidateQueries({ queryKey: ["plan-reviews"] });
      setSelectedReview({ ...review, ai_check_status: "complete", ai_findings: findings, previous_findings: prevFindings, finding_statuses: {} });
      setFindingStatuses({});
      toast.success(`AI check complete — ${findings.length} findings`, {
        action: { label: "View Findings", onClick: () => setActiveTab("findings") },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI check failed");
      await supabase.from("plan_reviews").update({ ai_check_status: "error" }).eq("id", review.id);
      queryClient.invalidateQueries({ queryKey: ["plan-reviews"] });
    } finally {
      setAiRunning(false);
    }
  };

  // Create new round (resubmission)
  const createNewRound = async () => {
    if (!selectedReview) return;
    try {
      const maxRound = (reviews || [])
        .filter((r) => r.project_id === selectedReview.project_id)
        .reduce((max, r) => Math.max(max, r.round), 0);

      const { data: newReview, error } = await supabase
        .from("plan_reviews")
        .insert({
          project_id: selectedReview.project_id,
          round: maxRound + 1,
          file_urls: selectedReview.file_urls,
          previous_findings: JSON.parse(JSON.stringify(selectedReview.ai_findings || [])),
        } as any)
        .select("*, project:projects(id, name, address, trade_type, county, jurisdiction)")
        .single();

      if (error) throw error;

      // Reset the 21-day clock by updating project deadline
      await supabase.from("projects").update({
        deadline_at: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString(),
      }).eq("id", selectedReview.project_id);

      queryClient.invalidateQueries({ queryKey: ["plan-reviews"] });
      setSelectedReview(newReview as PlanReviewRow);
      setFindingStatuses({});
      setCommentLetter("");
      toast.success(`Round ${maxRound + 1} created — 21-day clock reset`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create new round");
    }
  };

  const generateCommentLetter = async (review: PlanReviewRow) => {
    setGeneratingLetter(true);
    setCommentLetter("");
    setActiveTab("letter");
    try {
      await streamAI({
        action: "generate_comment_letter",
        payload: {
          project_name: review.project?.name,
          address: review.project?.address,
          trade_type: review.project?.trade_type,
          county: review.project?.county,
          jurisdiction: review.project?.jurisdiction,
          findings: review.ai_findings,
          round: review.round,
        },
        onDelta: (chunk) => setCommentLetter((prev) => prev + chunk),
        onDone: () => setGeneratingLetter(false),
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate letter");
      setGeneratingLetter(false);
    }
  };

  const copyLetter = () => {
    navigator.clipboard.writeText(commentLetter);
    setCopied(true);
    toast.success("Letter copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAnnotationClick = useCallback((index: number) => {
    setActiveFindingIndex(index);
    const el = findingRefs.current.get(index);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const handleLocateFinding = useCallback((index: number) => {
    setActiveFindingIndex(index);
  }, []);

  const findings = (selectedReview?.ai_findings as Finding[]) || [];
  const previousFindings = (selectedReview?.previous_findings as Finding[]) || [];
  const groupedFindings = groupFindingsByDiscipline(findings);
  const county = selectedReview?.project?.county || "";
  const hvhz = isHVHZ(county);
  const fileUrls = selectedReview?.file_urls || [];
  const hasMarkup = findings.some((f) => f.markup);

  // Filter findings by status
  const filteredFindings = statusFilter === "all"
    ? findings
    : findings.filter((_, i) => (findingStatuses[i] || "open") === statusFilter);

  const filteredGrouped = groupFindingsByDiscipline(filteredFindings);

  const criticalCount = findings.filter((f) => f.severity === "critical").length;
  const majorCount = findings.filter((f) => f.severity === "major").length;
  const minorCount = findings.filter((f) => f.severity === "minor").length;

  // Status counts
  const openCount = findings.filter((_, i) => !findingStatuses[i] || findingStatuses[i] === "open").length;
  const resolvedCount = findings.filter((_, i) => findingStatuses[i] === "resolved").length;
  const deferredCount = findings.filter((_, i) => findingStatuses[i] === "deferred").length;

  // Compute global finding index
  let globalIndexCounter = 0;
  const globalIndexMap = new Map<Finding, number>();
  for (const d of DISCIPLINE_ORDER) {
    if (!groupedFindings[d]) continue;
    for (const f of groupedFindings[d]) {
      globalIndexMap.set(f, globalIndexCounter++);
    }
  }

  // Get all rounds for this project
  const projectRounds = selectedReview
    ? (reviews || [])
        .filter((r) => r.project_id === selectedReview.project_id)
        .sort((a, b) => a.round - b.round)
        .map((r) => ({
          id: r.id,
          round: r.round,
          created_at: r.created_at,
          ai_check_status: r.ai_check_status,
          findingsCount: Array.isArray(r.ai_findings) ? (r.ai_findings as Finding[]).length : 0,
        }))
    : [];

  // Diff: identify new/carried-over findings
  const diffMap = new Map<number, "new" | "carried">();
  if (showDiff && previousFindings.length > 0) {
    for (let i = 0; i < findings.length; i++) {
      const f = findings[i];
      const match = previousFindings.find(
        (pf) => pf.code_ref === f.code_ref && pf.discipline === f.discipline
      );
      diffMap.set(i, match ? "carried" : "new");
    }
  }

  return (
    <div className="p-6 md:p-8 max-w-7xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-medium font-[var(--font-display)]">Plan Review</h1>
          <p className="text-sm text-muted-foreground mt-1">AI-powered code compliance analysis by county & jurisdiction</p>
        </div>
        <Button onClick={() => setWizardOpen(true)} className="bg-accent text-accent-foreground hover:bg-accent/90">
          <Plus className="h-4 w-4 mr-2" /> New Review
        </Button>
      </div>

      <NewPlanReviewWizard open={wizardOpen} onOpenChange={setWizardOpen} onComplete={handleWizardComplete} />

      {totalReviews > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <Card className="shadow-subtle border">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-semibold text-foreground">{totalReviews}</p>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Total Reviews</p>
            </CardContent>
          </Card>
          <Card className="shadow-subtle border">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-semibold text-[hsl(var(--success))]">{completedReviews}</p>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Completed</p>
            </CardContent>
          </Card>
          <Card className="shadow-subtle border">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-semibold text-foreground">{totalFindings}</p>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Total Findings</p>
            </CardContent>
          </Card>
        </div>
      )}

      {!isLoading && (reviews || []).length > 0 && (
        <div className="hidden md:grid grid-cols-[1fr_100px_120px_60px_80px_100px_80px_24px] gap-4 px-4 mb-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Project</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Trade</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">County</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Days</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Round</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Status</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Findings</span>
          <span />
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      ) : (reviews || []).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="h-16 w-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
            <FileSearch className="h-8 w-8 text-muted-foreground/30" />
          </div>
          <h2 className="text-lg font-medium">No reviews in queue</h2>
          <p className="text-sm text-muted-foreground mt-1 mb-4">Upload plan documents to start your first AI-powered review</p>
          <Button onClick={() => setWizardOpen(true)} variant="outline">
            <Plus className="h-4 w-4 mr-2" /> Start New Review
          </Button>
        </div>
      ) : (
        <div className="space-y-1.5">
          {(reviews || []).map((review) => {
            const findingsCount = Array.isArray(review.ai_findings) ? (review.ai_findings as Finding[]).length : 0;
            const critical = hasCriticalFindings(review);
            const hasFiles = review.file_urls && review.file_urls.length > 0;
            const daysLeft = getDaysRemaining(review.created_at);
            return (
              <Card
                key={review.id}
                className={cn(
                  "shadow-subtle border cursor-pointer hover:bg-muted/30 transition-colors relative overflow-hidden",
                  critical && "border-l-destructive border-l-2"
                )}
                onClick={() => { setSelectedReview(review); setCommentLetter(""); setCopied(false); setActiveTab("overview"); setPageImages([]); setActiveFindingIndex(null); setStatusFilter("all"); setShowDiff(false); }}
              >
                <CardContent className="p-4 grid grid-cols-1 md:grid-cols-[1fr_100px_120px_60px_80px_100px_80px_24px] gap-2 md:gap-4 items-center">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{review.project?.name || "Unnamed"}</p>
                      {hasFiles && <FileText className="h-3 w-3 text-accent shrink-0" />}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{review.project?.address}</p>
                  </div>
                  <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-medium capitalize w-fit">{review.project?.trade_type}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-medium">{getCountyLabel(review.project?.county || "")}</span>
                    {isHVHZ(review.project?.county || "") && <Wind className="h-3 w-3 text-destructive" />}
                  </div>
                  <div className="hidden md:flex items-center justify-center">
                    <DeadlineRing daysElapsed={21 - daysLeft} totalDays={21} size={28} />
                  </div>
                  <Badge variant="secondary" className="text-xs w-fit">R{review.round}</Badge>
                  <Badge
                    className={cn("text-[10px] w-fit", {
                      "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/20": review.ai_check_status === "complete",
                      "bg-accent/10 text-accent border-accent/20": review.ai_check_status === "running",
                      "bg-muted text-muted-foreground": review.ai_check_status === "pending",
                      "bg-destructive/10 text-destructive": review.ai_check_status === "error",
                    })}
                    variant="outline"
                  >
                    {review.ai_check_status}
                  </Badge>
                  <span className="text-xs text-muted-foreground font-medium">
                    {findingsCount > 0 ? `${findingsCount}` : "—"}
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/40 hidden md:block" />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Review detail panel */}
      <Sheet open={!!selectedReview} onOpenChange={(open) => !open && setSelectedReview(null)}>
        <SheetContent className="w-full sm:max-w-5xl overflow-y-auto" aria-describedby="review-detail-desc">
          <SheetHeader>
            <SheetTitle className="font-[var(--font-display)] text-xl">
              {selectedReview?.project?.name || "Plan Review"}
            </SheetTitle>
            <p id="review-detail-desc" className="sr-only">Review details and AI findings</p>
          </SheetHeader>

          {selectedReview && (
            <div className="mt-4">
              {/* Project info header */}
              <Card className="shadow-subtle border mb-4">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-2">
                      <p className="text-sm text-foreground/80">{selectedReview.project?.address}</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-medium capitalize">{selectedReview.project?.trade_type}</span>
                        <Badge variant="outline" className="text-xs font-medium">
                          {getCountyLabel(county)} County
                        </Badge>
                        {selectedReview.project?.jurisdiction && (
                          <span className="text-[10px] text-muted-foreground">
                            Jurisdiction: {selectedReview.project.jurisdiction}
                          </span>
                        )}
                        {fileUrls.length > 0 && (
                          <Badge variant="outline" className="text-[10px] text-accent border-accent/30">
                            <FileText className="h-3 w-3 mr-1" />{fileUrls.length} doc{fileUrls.length > 1 ? "s" : ""}
                          </Badge>
                        )}
                      </div>
                      {/* Round navigator */}
                      {projectRounds.length > 0 && (
                        <RoundNavigator
                          rounds={projectRounds}
                          currentRoundId={selectedReview.id}
                          onRoundSelect={(roundId) => {
                            const r = (reviews || []).find((rev) => rev.id === roundId);
                            if (r) {
                              setSelectedReview(r);
                              setCommentLetter("");
                              setPageImages([]);
                              setActiveFindingIndex(null);
                            }
                          }}
                          onNewRound={createNewRound}
                          showDiff={showDiff}
                          onToggleDiff={() => setShowDiff(!showDiff)}
                        />
                      )}
                    </div>
                    {findings.length > 0 && (
                      <SeverityDonut critical={criticalCount} major={majorCount} minor={minorCount} />
                    )}
                  </div>
                </CardContent>
              </Card>

              {hvhz && (
                <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 mb-4">
                  <Wind className="h-5 w-5 text-destructive shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-destructive">HVHZ — High Velocity Hurricane Zone</p>
                    <p className="text-xs text-destructive/80">Enhanced wind load & impact protection requirements apply per FBC 1626 and Miami-Dade TAS 201/202/203.</p>
                  </div>
                </div>
              )}

              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="w-full grid grid-cols-5 mb-4">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="findings" className="relative">
                    Findings
                    {findings.length > 0 && (
                      <span className="ml-1.5 text-[10px] bg-accent/15 text-accent rounded-full px-1.5 py-0.5 font-semibold">{findings.length}</span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="checklist">
                    <ClipboardCheck className="h-3.5 w-3.5 mr-1" />
                    Checklist
                  </TabsTrigger>
                  <TabsTrigger value="letter">Letter</TabsTrigger>
                  <TabsTrigger value="documents" className="relative">
                    Docs
                    {fileUrls.length > 0 && (
                      <span className="ml-1.5 text-[10px] bg-accent/15 text-accent rounded-full px-1.5 py-0.5 font-semibold">{fileUrls.length}</span>
                    )}
                  </TabsTrigger>
                </TabsList>

                {/* === Overview Tab === */}
                <TabsContent value="overview" className="space-y-4">
                  <Button
                    onClick={() => runAICheck(selectedReview)}
                    disabled={aiRunning}
                    className="w-full h-12 text-sm font-medium bg-accent text-accent-foreground hover:bg-accent/90"
                  >
                    {aiRunning ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Analyzing Plans...</>
                    ) : (
                      <><Sparkles className="h-4 w-4 mr-2" /> Run AI Pre-Check{county ? ` (${getCountyLabel(county)})` : ""}</>
                    )}
                  </Button>

                  {aiRunning && (
                    <Card className="shadow-subtle border">
                      <CardContent className="p-4">
                        {renderingPages && (
                          <div className="mb-3 space-y-1.5">
                            <div className="flex items-center gap-2 text-xs text-accent">
                              <Eye className="h-3.5 w-3.5 animate-pulse" />
                              <span>Rendering plan pages for visual analysis...</span>
                            </div>
                            <Progress value={renderProgress} className="h-1" />
                          </div>
                        )}
                        <ScanTimeline currentStep={scanStep} />
                      </CardContent>
                    </Card>
                  )}

                  {findings.length > 0 && (
                    <Card className="shadow-subtle border">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-4">
                          <SeverityDonut critical={criticalCount} major={majorCount} minor={minorCount} size={56} />
                          <div className="flex-1">
                            <p className="text-sm font-semibold">{findings.length} Findings</p>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              {criticalCount > 0 && <Badge className={cn("text-[10px]", severityColors.critical)}>{criticalCount} Critical</Badge>}
                              {majorCount > 0 && <Badge className={cn("text-[10px]", severityColors.major)}>{majorCount} Major</Badge>}
                              {minorCount > 0 && <Badge className={cn("text-[10px]", severityColors.minor)}>{minorCount} Minor</Badge>}
                            </div>
                            {/* Status summary */}
                            <div className="flex items-center gap-2 mt-2 text-[10px]">
                              <span className="text-destructive font-medium">{openCount} open</span>
                              <span className="text-[hsl(var(--success))] font-medium">{resolvedCount} resolved</span>
                              <span className="text-[hsl(var(--warning))] font-medium">{deferredCount} deferred</span>
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => setActiveTab("findings")}>View Findings →</Button>
                          {!commentLetter && (
                            <Button size="sm" variant="outline" onClick={() => generateCommentLetter(selectedReview)}>
                              <Sparkles className="h-3.5 w-3.5 mr-1" /> Generate Letter
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {fileUrls.length === 0 && (
                    <div
                      className="border-2 border-dashed border-border/60 rounded-lg p-6 text-center cursor-pointer hover:bg-muted/20 transition-colors"
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); handleFileUpload(e.dataTransfer.files); }}
                    >
                      <Upload className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                      <p className="text-sm font-medium text-muted-foreground">Upload plan documents</p>
                      <p className="text-xs text-muted-foreground/60 mt-1">Drag & drop PDF files or click to browse</p>
                      <input ref={fileInputRef} type="file" accept=".pdf" multiple className="hidden" onChange={(e) => handleFileUpload(e.target.files)} />
                    </div>
                  )}
                </TabsContent>

                {/* === Findings Tab (Split View) === */}
                <TabsContent value="findings" className="space-y-4">
                  {findings.length === 0 && !aiRunning && (
                    <div className="text-center py-12 text-muted-foreground">
                      <div className="h-14 w-14 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
                        <FileSearch className="h-7 w-7 text-muted-foreground/30" />
                      </div>
                      <p className="text-sm font-medium">No findings yet</p>
                      <p className="text-xs text-muted-foreground mt-1">Run AI Pre-Check from the Overview tab to analyze your plans.</p>
                    </div>
                  )}

                  {findings.length > 0 && (
                    <>
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-sm font-semibold">{findings.length} Findings</span>
                          {criticalCount > 0 && <Badge className={cn("text-[10px]", severityColors.critical)}>{criticalCount} Critical</Badge>}
                          {majorCount > 0 && <Badge className={cn("text-[10px]", severityColors.major)}>{majorCount} Major</Badge>}
                          {minorCount > 0 && <Badge className={cn("text-[10px]", severityColors.minor)}>{minorCount} Minor</Badge>}
                        </div>
                        <div className="flex items-center gap-2">
                          {hasMarkup && pageImages.length === 0 && !renderingPages && fileUrls.length > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-[10px] h-6 gap-1 text-accent border-accent/30"
                              onClick={() => selectedReview && renderDocumentPages(selectedReview)}
                            >
                              <Eye className="h-3 w-3" /> Load Annotations
                            </Button>
                          )}
                          {hasMarkup && pageImages.length > 0 && (
                            <Badge variant="outline" className="text-[10px] text-accent border-accent/30">
                              <Eye className="h-3 w-3 mr-1" /> Visual
                            </Badge>
                          )}
                          {renderingPages && (
                            <div className="flex items-center gap-1.5 text-[10px] text-accent">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              <span>Rendering...</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Status filter bar */}
                      <FindingStatusFilter
                        activeFilter={statusFilter}
                        counts={{
                          all: findings.length,
                          open: openCount,
                          resolved: resolvedCount,
                          deferred: deferredCount,
                        }}
                        onFilterChange={setStatusFilter}
                      />

                      {/* Diff legend */}
                      {showDiff && previousFindings.length > 0 && (
                        <div className="flex items-center gap-3 text-[10px] bg-muted/30 rounded-md px-3 py-1.5">
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-accent" /> New finding
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-muted-foreground/40" /> Carried from R{selectedReview.round - 1}
                          </span>
                        </div>
                      )}

                      <div className={cn("gap-4", hasMarkup && pageImages.length > 0 ? "grid grid-cols-1 lg:grid-cols-[3fr_2fr]" : "")}>
                        {hasMarkup && pageImages.length > 0 && (
                          <PlanMarkupViewer
                            pageImages={pageImages}
                            findings={findings}
                            activeFindingIndex={activeFindingIndex}
                            onAnnotationClick={handleAnnotationClick}
                            className="h-[500px] sticky top-0"
                          />
                        )}

                        <div className="space-y-1">
                          <Accordion type="multiple" defaultValue={DISCIPLINE_ORDER.filter((d) => filteredGrouped[d])} className="space-y-1">
                            {DISCIPLINE_ORDER.filter((d) => filteredGrouped[d]).map((discipline) => {
                              const group = filteredGrouped[discipline];
                              const Icon = getDisciplineIcon(discipline);
                              const worst = getWorstSeverity(group);
                              return (
                                <AccordionItem key={discipline} value={discipline} className="border rounded-lg overflow-hidden">
                                  <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/30">
                                    <div className="flex items-center gap-3">
                                      <Icon className={cn("h-4 w-4", getDisciplineColor(discipline))} />
                                      <span className="text-sm font-medium">{getDisciplineLabel(discipline)}</span>
                                      <Badge variant="secondary" className="text-[10px]">{group.length}</Badge>
                                      <div className={cn("h-2 w-2 rounded-full", {
                                        "bg-destructive": worst === "critical",
                                        "bg-[hsl(var(--warning))]": worst === "major",
                                        "bg-muted-foreground/40": worst === "minor",
                                      })} />
                                    </div>
                                  </AccordionTrigger>
                                  <AccordionContent className="px-4 pb-4 space-y-2">
                                    {group.map((finding, i) => {
                                      const gi = globalIndexMap.get(finding)!;
                                      const diffStatus = diffMap.get(gi);
                                      return (
                                        <div key={i} className="relative">
                                          {showDiff && diffStatus && (
                                            <div className={cn(
                                              "absolute -left-3 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full z-10",
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
                                            animationDelay={i * 60}
                                            status={findingStatuses[gi] || "open"}
                                            onStatusChange={(status) => updateFindingStatus(gi, status)}
                                          />
                                        </div>
                                      );
                                    })}
                                  </AccordionContent>
                                </AccordionItem>
                              );
                            })}
                          </Accordion>
                        </div>
                      </div>
                    </>
                  )}
                </TabsContent>

                {/* === Checklist Tab === */}
                <TabsContent value="checklist" className="space-y-4">
                  <DisciplineChecklist
                    tradeType={selectedReview.project?.trade_type || "building"}
                    findings={findings}
                  />
                </TabsContent>

                {/* === Comment Letter Tab === */}
                <TabsContent value="letter" className="space-y-4">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Comment Letter</h3>
                    <div className="flex gap-2 flex-wrap">
                      {/* Formal PDF export */}
                      {findings.length > 0 && (
                        <CommentLetterExport
                          projectName={selectedReview.project?.name || ""}
                          address={selectedReview.project?.address || ""}
                          county={county}
                          jurisdiction={selectedReview.project?.jurisdiction || ""}
                          tradeType={selectedReview.project?.trade_type || ""}
                          round={selectedReview.round}
                          findings={findings}
                          findingStatuses={Object.fromEntries(
                            Object.entries(findingStatuses).map(([k, v]) => [Number(k), v])
                          )}
                        />
                      )}
                      {commentLetter && !generatingLetter && (
                        <Button size="sm" variant="outline" onClick={copyLetter}>
                          {copied ? <Check className="h-3.5 w-3.5 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
                          {copied ? "Copied" : "Copy"}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => generateCommentLetter(selectedReview)}
                        disabled={generatingLetter || findings.length === 0}
                      >
                        {generatingLetter ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
                        {commentLetter ? "Regenerate" : "Generate Letter"}
                      </Button>
                    </div>
                  </div>

                  {findings.length === 0 && (
                    <div className="text-center py-12">
                      <div className="h-14 w-14 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
                        <FileText className="h-7 w-7 text-muted-foreground/30" />
                      </div>
                      <p className="text-sm font-medium text-muted-foreground">Run AI Pre-Check first</p>
                      <p className="text-xs text-muted-foreground mt-1">Generate findings to create a comment letter.</p>
                    </div>
                  )}

                  {(commentLetter || generatingLetter) && (
                    <div className="rounded-lg border-2 border-border bg-card shadow-sm overflow-hidden">
                      <div className="border-b bg-muted/30 px-6 py-3 flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                          Florida Private Providers — Official Comment Letter
                        </p>
                        {generatingLetter && <Loader2 className="h-3.5 w-3.5 text-accent animate-spin" />}
                      </div>
                      <Textarea
                        value={commentLetter}
                        onChange={(e) => setCommentLetter(e.target.value)}
                        rows={20}
                        className="font-[var(--font-mono)] text-xs border-0 rounded-none focus-visible:ring-0 focus-visible:ring-offset-0 resize-y"
                        placeholder={generatingLetter ? "Generating letter..." : ""}
                      />
                    </div>
                  )}
                  {commentLetter && !generatingLetter && (
                    <Button size="sm" className="bg-accent text-accent-foreground hover:bg-accent/90">
                      <Send className="h-3.5 w-3.5 mr-1" /> Send to Contractor
                    </Button>
                  )}
                </TabsContent>

                {/* === Documents Tab === */}
                <TabsContent value="documents" className="space-y-4">
                  <div
                    className={cn(
                      "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:bg-muted/20 transition-colors",
                      uploading ? "border-accent/50 bg-accent/5" : "border-border/60"
                    )}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); handleFileUpload(e.dataTransfer.files); }}
                  >
                    {uploading ? (
                      <Loader2 className="h-8 w-8 text-accent mx-auto mb-2 animate-spin" />
                    ) : (
                      <Upload className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                    )}
                    <p className="text-sm font-medium text-muted-foreground">{uploading ? "Uploading..." : "Upload plan documents"}</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">PDF files up to 20MB each</p>
                    <input ref={fileInputRef} type="file" accept=".pdf" multiple className="hidden" onChange={(e) => handleFileUpload(e.target.files)} />
                  </div>

                  {fileUrls.length > 0 && (
                    <div className="space-y-2">
                      {fileUrls.map((url, i) => {
                        const name = url.split("/").pop() || `Document ${i + 1}`;
                        return (
                          <Card key={i} className="shadow-subtle border">
                            <CardContent className="p-3 flex items-center gap-3">
                              <FileText className="h-5 w-5 text-accent shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{decodeURIComponent(name)}</p>
                              </div>
                              <Button size="sm" variant="ghost" asChild>
                                <a href={url} target="_blank" rel="noopener noreferrer">View</a>
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeFile(url)}>
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  )}

                  {fileUrls.length > 0 && (
                    <div className="rounded-lg border overflow-hidden">
                      <div className="bg-muted/30 px-4 py-2 border-b">
                        <p className="text-xs font-medium text-muted-foreground">
                          Document Preview — {decodeURIComponent(fileUrls[0].split("/").pop() || "")}
                        </p>
                      </div>
                      <iframe src={fileUrls[0]} className="w-full h-[600px] bg-background" title="Plan document viewer" />
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
