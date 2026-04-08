import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { callAI, streamAI } from "@/lib/ai";
import { renderPDFPagesToImages, type PDFPageImage } from "@/lib/pdf-utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sparkles, Send, Loader2, Copy, Check,
  Wind, Upload, ArrowLeft, Mail, Phone,
  FileDown, Printer, Plus
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { FindingCard, type Finding } from "@/components/FindingCard";
import { SeverityDonut } from "@/components/SeverityDonut";
import { ScanTimeline } from "@/components/ScanTimeline";
import { PlanMarkupViewer } from "@/components/PlanMarkupViewer";
import { DeadlineRing } from "@/components/DeadlineRing";
import { FindingStatusFilter, type FindingStatus } from "@/components/FindingStatusFilter";
import { DisciplineChecklist } from "@/components/DisciplineChecklist";
import { CommentLetterExport } from "@/components/CommentLetterExport";
import {
  isHVHZ, getCountyLabel, getDisciplineIcon, getDisciplineColor,
  getDisciplineLabel, DISCIPLINE_ORDER, SCANNING_STEPS,
} from "@/lib/county-utils";

interface ContractorInfo {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  license_number: string | null;
}

interface ProjectInfo {
  id: string;
  name: string;
  address: string;
  trade_type: string;
  county: string;
  jurisdiction: string;
  contractor: ContractorInfo | null;
}

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
  project?: ProjectInfo | null;
}

type RightPanelMode = "findings" | "checklist" | "letter";

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

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: Error | null = null;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (i < maxRetries - 1) await new Promise((r) => setTimeout(r, Math.pow(2, i) * 1000));
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

export default function PlanReviewDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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
        .select("id, round, created_at, ai_check_status, ai_findings")
        .eq("project_id", review!.project_id)
        .order("round");
      if (error) throw error;
      return data;
    },
    enabled: !!review?.project_id,
  });

  const [aiRunning, setAiRunning] = useState(false);
  const [scanStep, setScanStep] = useState(0);
  const [commentLetter, setCommentLetter] = useState("");
  const [generatingLetter, setGeneratingLetter] = useState(false);
  const [copied, setCopied] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [rightPanel, setRightPanel] = useState<RightPanelMode>("findings");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeFindingIndex, setActiveFindingIndex] = useState<number | null>(null);
  const [pageImages, setPageImages] = useState<PDFPageImage[]>([]);
  const [renderingPages, setRenderingPages] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const findingRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [findingStatuses, setFindingStatuses] = useState<Record<number, FindingStatus>>({});
  const [statusFilter, setStatusFilter] = useState<FindingStatus | "all">("all");
  const [showDiff, setShowDiff] = useState(false);

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
      const next = { ...prev, [index]: status };
      if (review) persistFindingStatuses(review.id, next);
      return next;
    });
  }, [review, persistFindingStatuses]);

  useEffect(() => {
    if (!aiRunning) { setScanStep(0); return; }
    const interval = setInterval(() => {
      setScanStep((s) => (s + 1) % SCANNING_STEPS.length);
    }, 1800);
    return () => clearInterval(interval);
  }, [aiRunning]);

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || !review) return;
    setUploading(true);
    try {
      const newUrls: string[] = [...(review.file_urls || [])];
      for (const file of Array.from(files)) {
        if (file.type !== "application/pdf") { toast.error(`${file.name} is not a PDF`); continue; }
        if (file.size > 20 * 1024 * 1024) { toast.error(`${file.name} exceeds 20MB limit`); continue; }
        const path = `plan-reviews/${review.id}/${file.name}`;
        const { error: uploadError } = await supabase.storage.from("documents").upload(path, file, { upsert: true });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from("documents").getPublicUrl(path);
        newUrls.push(urlData.publicUrl);
      }
      await supabase.from("plan_reviews").update({ file_urls: newUrls }).eq("id", review.id);
      queryClient.invalidateQueries({ queryKey: ["plan-review", id] });
      hasAutoRendered.current = false; // allow re-render
      toast.success("Documents uploaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const removeFile = async (urlToRemove: string) => {
    if (!review) return;
    const newUrls = (review.file_urls || []).filter((u) => u !== urlToRemove);
    await supabase.from("plan_reviews").update({ file_urls: newUrls }).eq("id", review.id);
    queryClient.invalidateQueries({ queryKey: ["plan-review", id] });
  };

  const renderDocumentPages = async (r: PlanReviewRow): Promise<PDFPageImage[]> => {
    if (!r.file_urls || r.file_urls.length === 0) return [];
    setRenderingPages(true);
    setRenderProgress(0);
    try {
      const allImages: PDFPageImage[] = [];
      for (let fi = 0; fi < r.file_urls.length; fi++) {
        const url = r.file_urls[fi];
        const response = await fetch(url);
        const blob = await response.blob();
        const file = new File([blob], `doc-${fi}.pdf`, { type: "application/pdf" });
        const images = await renderPDFPagesToImages(file, 10, 150);
        allImages.push(...images.map((img, idx) => ({ ...img, pageIndex: allImages.length + idx })));
        setRenderProgress(((fi + 1) / r.file_urls.length) * 100);
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

  const runAICheck = async (r: PlanReviewRow) => {
    setAiRunning(true);
    setRightPanel("findings");
    setActiveFindingIndex(null);
    try {
      await supabase.from("plan_reviews").update({ ai_check_status: "running" }).eq("id", r.id);

      let findings: Finding[] = [];
      const hasFiles = r.file_urls && r.file_urls.length > 0;

      if (hasFiles) {
        const images = pageImages.length > 0 ? pageImages : await renderDocumentPages(r);
        if (images.length > 0) {
          const result = await withRetry(() =>
            callAI({
              action: "plan_review_check_visual",
              payload: {
                project_name: r.project?.name,
                address: r.project?.address,
                trade_type: r.project?.trade_type,
                county: r.project?.county,
                jurisdiction: r.project?.jurisdiction,
                round: r.round,
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
          project_name: r.project?.name,
          address: r.project?.address,
          trade_type: r.project?.trade_type,
          county: r.project?.county,
          jurisdiction: r.project?.jurisdiction,
          round: r.round,
        };
        if (hasFiles) {
          payload.document_context = `Plans attached: ${r.file_urls.map((u) => decodeURIComponent(u.split("/").pop() || "")).join(", ")}`;
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

      const prevFindings = r.ai_findings || [];

      await supabase.from("plan_reviews").update({
        ai_check_status: "complete",
        ai_findings: JSON.parse(JSON.stringify(findings)),
        previous_findings: JSON.parse(JSON.stringify(prevFindings)),
        finding_statuses: {},
      }).eq("id", r.id);

      queryClient.invalidateQueries({ queryKey: ["plan-review", id] });
      setFindingStatuses({});
      toast.success(`AI check complete — ${findings.length} findings`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI check failed");
      await supabase.from("plan_reviews").update({ ai_check_status: "error" }).eq("id", r.id);
    } finally {
      setAiRunning(false);
    }
  };

  const createNewRound = async () => {
    if (!review || !allRounds) return;
    try {
      const maxRound = allRounds.reduce((max, r) => Math.max(max, r.round), 0);
      const { data: newReview, error } = await supabase
        .from("plan_reviews")
        .insert({
          project_id: review.project_id,
          round: maxRound + 1,
          file_urls: review.file_urls,
          previous_findings: JSON.parse(JSON.stringify(review.ai_findings || [])),
        } as any)
        .select("id")
        .single();
      if (error) throw error;

      await supabase.from("projects").update({
        deadline_at: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString(),
      }).eq("id", review.project_id);

      toast.success(`Round ${maxRound + 1} created`);
      navigate(`/plan-review/${newReview.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create new round");
    }
  };

  const generateCommentLetter = async (r: PlanReviewRow) => {
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
          findings: r.ai_findings,
          round: r.round,
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

  const findings = (review.ai_findings as Finding[]) || [];
  const previousFindings = (review.previous_findings as Finding[]) || [];
  const groupedFindings = groupFindingsByDiscipline(findings);
  const county = review.project?.county || "";
  const hvhz = isHVHZ(county);
  const fileUrls = review.file_urls || [];
  const hasMarkup = findings.some((f) => f.markup);
  const contractor = review.project?.contractor || null;

  const filteredFindings = statusFilter === "all"
    ? findings
    : findings.filter((_, i) => (findingStatuses[i] || "open") === statusFilter);
  const filteredGrouped = groupFindingsByDiscipline(filteredFindings);

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

  const diffMap = new Map<number, "new" | "carried">();
  if (showDiff && previousFindings.length > 0) {
    for (let i = 0; i < findings.length; i++) {
      const f = findings[i];
      const match = previousFindings.find((pf) => pf.code_ref === f.code_ref && pf.discipline === f.discipline);
      diffMap.set(i, match ? "carried" : "new");
    }
  }

  const projectRounds = (allRounds || []).map((r) => ({
    id: r.id,
    round: r.round,
    created_at: r.created_at,
    ai_check_status: r.ai_check_status,
    findingsCount: Array.isArray(r.ai_findings) ? (r.ai_findings as unknown as Finding[]).length : 0,
  }));

  const hasDocuments = fileUrls.length > 0;
  const hasFindings = findings.length > 0;

  return (
    <div className="flex flex-col h-[calc(100vh-0px)] overflow-hidden">
      {/* ── Top Bar ── */}
      <div className="shrink-0 border-b bg-card px-4 py-2.5">
        <div className="flex items-center gap-3">
          {/* Back + Project Name */}
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => navigate("/plan-review")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold truncate">{review.project?.name || "Plan Review"}</h1>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium capitalize shrink-0">{review.project?.trade_type}</span>
              {hvhz && (
                <span className="flex items-center gap-0.5 text-[9px] font-semibold text-destructive shrink-0">
                  <Wind className="h-3 w-3" /> HVHZ
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="truncate">{review.project?.address}</span>
              <span>{getCountyLabel(county)} County</span>
              {contractor && (
                <>
                  <span className="text-foreground font-medium">{contractor.name}</span>
                  {contractor.email && (
                    <a href={`mailto:${contractor.email}`} className="flex items-center gap-0.5 hover:text-accent transition-colors">
                      <Mail className="h-2.5 w-2.5" /> {contractor.email}
                    </a>
                  )}
                  {contractor.phone && (
                    <a href={`tel:${contractor.phone}`} className="flex items-center gap-0.5 hover:text-accent transition-colors">
                      <Phone className="h-2.5 w-2.5" /> {contractor.phone}
                    </a>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Round pills */}
          <div className="flex items-center gap-1 shrink-0">
            {projectRounds.map((round) => (
              <button
                key={round.id}
                onClick={() => navigate(`/plan-review/${round.id}`)}
                className={cn(
                  "px-2 py-0.5 rounded-full text-[10px] font-semibold transition-all",
                  round.id === review.id
                    ? "bg-accent text-accent-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
              >
                R{round.round}
              </button>
            ))}
            <button
              onClick={createNewRound}
              className="px-1.5 py-0.5 rounded-full text-[10px] text-muted-foreground hover:bg-muted transition-colors"
              title="New round"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>

          {/* Deadline ring */}
          <DeadlineRing daysElapsed={21 - daysLeft} totalDays={21} size={30} />

          {/* Primary action */}
          <Button
            size="sm"
            onClick={() => runAICheck(review)}
            disabled={aiRunning}
            className="bg-accent text-accent-foreground hover:bg-accent/90 h-8 text-xs shrink-0"
          >
            {aiRunning ? (
              <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Analyzing...</>
            ) : (
              <><Sparkles className="h-3.5 w-3.5 mr-1.5" /> {hasFindings ? "Re-Analyze" : "Run AI Check"}</>
            )}
          </Button>
        </div>
      </div>

      {/* ── AI Scanning Overlay ── */}
      {aiRunning && (
        <div className="shrink-0 border-b bg-accent/5 px-4 py-3">
          <div className="max-w-lg">
            {renderingPages && (
              <div className="mb-2 space-y-1">
                <p className="text-[11px] text-accent font-medium">Rendering plan pages for visual analysis...</p>
                <Progress value={renderProgress} className="h-1" />
              </div>
            )}
            <ScanTimeline currentStep={scanStep} />
          </div>
        </div>
      )}

      {/* ── Main Split Layout ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── LEFT: Document Viewer ── */}
        <div className="flex-1 flex flex-col min-w-0 border-r">
          {hasDocuments ? (
            <>
              {/* PDF rendering progress */}
              {renderingPages && pageImages.length === 0 && (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center space-y-3">
                    <Loader2 className="h-8 w-8 text-accent mx-auto animate-spin" />
                    <p className="text-sm text-muted-foreground">Loading document...</p>
                    <Progress value={renderProgress} className="h-1 w-48 mx-auto" />
                  </div>
                </div>
              )}

              {/* PDF viewer */}
              {pageImages.length > 0 && (
                <PlanMarkupViewer
                  pageImages={pageImages}
                  findings={findings}
                  activeFindingIndex={activeFindingIndex}
                  onAnnotationClick={handleAnnotationClick}
                  className="flex-1"
                />
              )}

              {/* File list strip at bottom */}
              <div className="shrink-0 border-t bg-muted/20 px-3 py-1.5 flex items-center gap-2 overflow-x-auto">
                {fileUrls.map((url, i) => {
                  const name = decodeURIComponent(url.split("/").pop() || `Doc ${i + 1}`);
                  return (
                    <span key={i} className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded truncate max-w-[200px]">
                      {name}
                    </span>
                  );
                })}
                <button
                  className="text-[10px] text-accent hover:text-accent/80 transition-colors shrink-0"
                  onClick={() => fileInputRef.current?.click()}
                >
                  + Add file
                </button>
                <input ref={fileInputRef} type="file" accept=".pdf" multiple className="hidden" onChange={(e) => handleFileUpload(e.target.files)} />
              </div>
            </>
          ) : (
            /* Upload prompt */
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
                <p className="text-sm font-medium text-foreground">
                  {uploading ? "Uploading..." : "Drop plan documents here"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">PDF files up to 20MB</p>
                <input ref={fileInputRef} type="file" accept=".pdf" multiple className="hidden" onChange={(e) => handleFileUpload(e.target.files)} />
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT: Findings / Checklist / Letter Panel ── */}
        <div className="w-[420px] shrink-0 flex flex-col overflow-hidden bg-card">
          {/* Panel mode toggle */}
          <div className="shrink-0 px-3 py-2 border-b flex items-center gap-1">
            {(["findings", "checklist", "letter"] as RightPanelMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setRightPanel(mode)}
                className={cn(
                  "px-3 py-1 rounded-md text-xs font-medium transition-all capitalize",
                  rightPanel === mode
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted/50"
                )}
              >
                {mode}
                {mode === "findings" && hasFindings && (
                  <span className="ml-1 text-[9px] opacity-70">{findings.length}</span>
                )}
              </button>
            ))}

            {/* Severity summary in header */}
            {hasFindings && rightPanel === "findings" && (
              <div className="ml-auto flex items-center gap-1.5">
                <SeverityDonut critical={criticalCount} major={majorCount} minor={minorCount} size={24} />
                <span className="text-[10px] text-muted-foreground">
                  {openCount} open
                </span>
              </div>
            )}
          </div>

          {/* Panel content */}
          <div className="flex-1 overflow-y-auto">
            {/* ── FINDINGS ── */}
            {rightPanel === "findings" && (
              <div className="p-3 space-y-2">
                {!hasFindings && !aiRunning && (
                  <div className="text-center py-16">
                    <p className="text-sm text-muted-foreground">No findings yet</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      {hasDocuments ? "Click \"Run AI Check\" to analyze your plans" : "Upload documents first"}
                    </p>
                  </div>
                )}

                {hasFindings && (
                  <>
                    <FindingStatusFilter
                      activeFilter={statusFilter}
                      counts={{ all: findings.length, open: openCount, resolved: resolvedCount, deferred: deferredCount }}
                      onFilterChange={setStatusFilter}
                    />

                    {showDiff && previousFindings.length > 0 && (
                      <div className="flex items-center gap-3 text-[10px] bg-muted/30 rounded-md px-2 py-1">
                        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-accent" /> New</span>
                        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" /> Carried</span>
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
                                  "bg-[hsl(var(--warning))]": worst === "major",
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
                                    {showDiff && diffStatus && (
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
                                      animationDelay={i * 40}
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
                  </>
                )}
              </div>
            )}

            {/* ── CHECKLIST ── */}
            {rightPanel === "checklist" && (
              <div className="p-3">
                <DisciplineChecklist
                  tradeType={review.project?.trade_type || "building"}
                  findings={findings}
                />
              </div>
            )}

            {/* ── LETTER ── */}
            {rightPanel === "letter" && (
              <div className="p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Comment Letter</span>
                  <div className="flex items-center gap-1.5">
                    {hasFindings && (
                      <CommentLetterExport
                        projectName={review.project?.name || ""}
                        address={review.project?.address || ""}
                        county={county}
                        jurisdiction={review.project?.jurisdiction || ""}
                        tradeType={review.project?.trade_type || ""}
                        round={review.round}
                        findings={findings}
                        findingStatuses={Object.fromEntries(
                          Object.entries(findingStatuses).map(([k, v]) => [Number(k), v])
                        )}
                      />
                    )}
                    {commentLetter && !generatingLetter && (
                      <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={copyLetter}>
                        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      </Button>
                    )}
                  </div>
                </div>

                {!hasFindings && (
                  <div className="text-center py-12">
                    <p className="text-xs text-muted-foreground">Run AI check first to generate findings</p>
                  </div>
                )}

                {hasFindings && !commentLetter && !generatingLetter && (
                  <Button
                    variant="outline"
                    className="w-full h-10 text-xs"
                    onClick={() => generateCommentLetter(review)}
                  >
                    <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Generate Comment Letter
                  </Button>
                )}

                {(commentLetter || generatingLetter) && (
                  <>
                    <div className="rounded-lg border bg-background overflow-hidden">
                      <div className="border-b bg-muted/30 px-4 py-2 flex items-center justify-between">
                        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                          FLPPI — Comment Letter
                        </span>
                        {generatingLetter && <Loader2 className="h-3 w-3 text-accent animate-spin" />}
                      </div>
                      <Textarea
                        value={commentLetter}
                        onChange={(e) => setCommentLetter(e.target.value)}
                        rows={18}
                        className="font-mono text-[11px] border-0 rounded-none focus-visible:ring-0 focus-visible:ring-offset-0 resize-y"
                        placeholder={generatingLetter ? "Generating..." : ""}
                      />
                    </div>
                    {commentLetter && !generatingLetter && (
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="text-xs flex-1" onClick={() => generateCommentLetter(review)}>
                          <Sparkles className="h-3 w-3 mr-1" /> Regenerate
                        </Button>
                        <Button size="sm" className="text-xs flex-1 bg-accent text-accent-foreground hover:bg-accent/90">
                          <Send className="h-3 w-3 mr-1" /> Send to Contractor
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}