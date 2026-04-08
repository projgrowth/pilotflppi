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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sparkles, Send, Loader2, Copy, Check,
  Wind, Upload, FileText, X, ArrowLeft, Eye, Mail, Phone
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { FindingCard, type Finding } from "@/components/FindingCard";
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

  // Fetch all rounds for this project
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
  const [activeTab, setActiveTab] = useState("overview");
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
    setActiveTab("findings");
    setActiveFindingIndex(null);
    try {
      await supabase.from("plan_reviews").update({ ai_check_status: "running" }).eq("id", r.id);

      let findings: Finding[] = [];
      const hasFiles = r.file_urls && r.file_urls.length > 0;

      if (hasFiles) {
        const images = await renderDocumentPages(r);
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
    setActiveTab("letter");
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
    const el = findingRefs.current.get(index);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  // Auto-load annotations when locating a finding
  const handleLocateFinding = useCallback(async (index: number) => {
    setActiveFindingIndex(index);
    if (pageImages.length === 0 && review && review.file_urls.length > 0) {
      await renderDocumentPages(review);
    }
  }, [pageImages.length, review]);

  if (isLoading) {
    return (
      <div className="p-6 md:p-8 max-w-7xl space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 rounded-lg" />
        <Skeleton className="h-60 rounded-lg" />
      </div>
    );
  }

  if (!review) {
    return (
      <div className="p-6 md:p-8 max-w-7xl text-center py-20">
        <p className="text-muted-foreground">Review not found</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/plan-review")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Reviews
        </Button>
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

  const projectRounds = (allRounds || []).map((r) => ({
    id: r.id,
    round: r.round,
    created_at: r.created_at,
    ai_check_status: r.ai_check_status,
    findingsCount: Array.isArray(r.ai_findings) ? (r.ai_findings as unknown as Finding[]).length : 0,
  }));

  const diffMap = new Map<number, "new" | "carried">();
  if (showDiff && previousFindings.length > 0) {
    for (let i = 0; i < findings.length; i++) {
      const f = findings[i];
      const match = previousFindings.find((pf) => pf.code_ref === f.code_ref && pf.discipline === f.discipline);
      diffMap.set(i, match ? "carried" : "new");
    }
  }

  return (
    <div className="p-6 md:p-8 max-w-7xl">
      {/* Back button + title */}
      <div className="mb-6 flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/plan-review")} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Reviews
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold">{review.project?.name || "Plan Review"}</h1>
          <p className="text-sm text-muted-foreground">{review.project?.address}</p>
        </div>
        <DeadlineRing daysElapsed={21 - daysLeft} totalDays={21} size={36} />
      </div>

      {/* Project + Contractor info header */}
      <Card className="shadow-subtle border mb-4">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-medium capitalize">{review.project?.trade_type}</span>
                <Badge variant="outline" className="text-xs font-medium">
                  {getCountyLabel(county)} County
                </Badge>
                {review.project?.jurisdiction && (
                  <span className="text-[10px] text-muted-foreground">
                    {review.project.jurisdiction}
                  </span>
                )}
                {fileUrls.length > 0 && (
                  <Badge variant="outline" className="text-[10px] text-accent border-accent/30">
                    {fileUrls.length} doc{fileUrls.length > 1 ? "s" : ""}
                  </Badge>
                )}
              </div>

              {/* Contractor info */}
              {contractor && (
                <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1 border-t border-border/40 mt-2">
                  <span className="font-medium text-foreground">{contractor.name}</span>
                  {contractor.license_number && (
                    <span>Lic# {contractor.license_number}</span>
                  )}
                  {contractor.email && (
                    <a href={`mailto:${contractor.email}`} className="flex items-center gap-1 hover:text-accent transition-colors">
                      <Mail className="h-3 w-3" /> {contractor.email}
                    </a>
                  )}
                  {contractor.phone && (
                    <a href={`tel:${contractor.phone}`} className="flex items-center gap-1 hover:text-accent transition-colors">
                      <Phone className="h-3 w-3" /> {contractor.phone}
                    </a>
                  )}
                </div>
              )}

              {projectRounds.length > 0 && (
                <RoundNavigator
                  rounds={projectRounds}
                  currentRoundId={review.id}
                  onRoundSelect={(roundId) => navigate(`/plan-review/${roundId}`)}
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
          <TabsTrigger value="checklist">Checklist</TabsTrigger>
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
            onClick={() => runAICheck(review)}
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
                    <div className="flex items-center gap-2 mt-2 text-[10px]">
                      <span className="text-destructive font-medium">{openCount} open</span>
                      <span className="text-[hsl(var(--success))] font-medium">{resolvedCount} resolved</span>
                      <span className="text-[hsl(var(--warning))] font-medium">{deferredCount} deferred</span>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setActiveTab("findings")}>View Findings</Button>
                  {!commentLetter && (
                    <Button size="sm" variant="outline" onClick={() => generateCommentLetter(review)}>
                      Generate Letter
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
              <p className="text-sm font-medium">No findings yet</p>
              <p className="text-xs mt-1">Run AI Pre-Check from the Overview tab to analyze your plans.</p>
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
                  {hasMarkup && pageImages.length > 0 && (
                    <Badge variant="outline" className="text-[10px] text-accent border-accent/30">Visual</Badge>
                  )}
                  {renderingPages && (
                    <div className="flex items-center gap-1.5 text-[10px] text-accent">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>Rendering...</span>
                    </div>
                  )}
                </div>
              </div>

              <FindingStatusFilter
                activeFilter={statusFilter}
                counts={{ all: findings.length, open: openCount, resolved: resolvedCount, deferred: deferredCount }}
                onFilterChange={setStatusFilter}
              />

              {showDiff && previousFindings.length > 0 && (
                <div className="flex items-center gap-3 text-[10px] bg-muted/30 rounded-md px-3 py-1.5">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-accent" /> New</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-muted-foreground/40" /> Carried from R{review.round - 1}</span>
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
            tradeType={review.project?.trade_type || "building"}
            findings={findings}
          />
        </TabsContent>

        {/* === Comment Letter Tab === */}
        <TabsContent value="letter" className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Comment Letter</h3>
            <div className="flex gap-2 flex-wrap">
              {findings.length > 0 && (
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
                <Button size="sm" variant="outline" onClick={copyLetter}>
                  {copied ? <Check className="h-3.5 w-3.5 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => generateCommentLetter(review)}
                disabled={generatingLetter || findings.length === 0}
              >
                {generatingLetter ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
                {commentLetter ? "Regenerate" : "Generate Letter"}
              </Button>
            </div>
          </div>

          {findings.length === 0 && (
            <div className="text-center py-12">
              <p className="text-sm font-medium text-muted-foreground">Run AI Pre-Check first</p>
              <p className="text-xs text-muted-foreground mt-1">Generate findings to create a comment letter.</p>
            </div>
          )}

          {(commentLetter || generatingLetter) && (
            <div className="rounded-lg border-2 border-border bg-card shadow-sm overflow-hidden">
              <div className="border-b bg-muted/30 px-6 py-3 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  FLPPI — Official Comment Letter
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

        {/* === Documents Tab — pdfjs-based preview === */}
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
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeFile(url)}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* PDF preview using pdfjs renderer instead of iframe */}
          {fileUrls.length > 0 && (
            <>
              {pageImages.length === 0 && !renderingPages && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => renderDocumentPages(review)}
                >
                  <Eye className="h-4 w-4 mr-2" /> Render Document Preview
                </Button>
              )}
              {renderingPages && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-accent">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Rendering pages...
                  </div>
                  <Progress value={renderProgress} className="h-1.5" />
                </div>
              )}
              {pageImages.length > 0 && (
                <PlanMarkupViewer
                  pageImages={pageImages}
                  findings={findings}
                  activeFindingIndex={activeFindingIndex}
                  onAnnotationClick={handleAnnotationClick}
                  className="h-[600px]"
                />
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
