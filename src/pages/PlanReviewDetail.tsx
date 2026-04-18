import { useState, useEffect, useRef, useCallback } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { callAI, streamAI } from "@/lib/ai";
import { renderPDFPagesToImages, renderPDFPagesForVisionWithGrid, gridCellToCenter, extractPagesTextItems, snapToNearestText, getPDFPageCount, renderZoomCropForCell, type PDFPageImage, type PDFTextItem } from "@/lib/pdf-utils";
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
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FindingCard, type Finding } from "@/components/FindingCard";
import { SeverityDonut } from "@/components/SeverityDonut";
import { ScanTimeline } from "@/components/ScanTimeline";
import { PlanMarkupViewer } from "@/components/PlanMarkupViewer";
import { FindingStatusFilter, type FindingStatus } from "@/components/FindingStatusFilter";
import { BulkTriageFilters, type ConfidenceFilter } from "@/components/BulkTriageFilters";
import { DisciplineChecklist } from "@/components/DisciplineChecklist";
import { SitePlanChecklist } from "@/components/SitePlanChecklist";
import { getCountyRequirements } from "@/lib/county-requirements";
import {
  isHVHZ, getDisciplineIcon, getDisciplineColor,
  getDisciplineLabel, DISCIPLINE_ORDER, SCANNING_STEPS,
} from "@/lib/county-utils";
import type { PlanReviewRow } from "@/types";

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


export default function PlanReviewDetail() {
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState<"plans" | "findings">("plans");
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { firmSettings } = useFirmSettings();
  const { user } = useAuth();
  const { data: findingHistory, refetch: refetchHistory } = useFindingHistory(id);

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
  const letterAbortRef = useRef<AbortController | null>(null);
  const [copied, setCopied] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [rightPanel, setRightPanel] = useState<RightPanelMode>("findings");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeFindingIndex, setActiveFindingIndex] = useState<number | null>(null);
  const [pageImages, setPageImages] = useState<PDFPageImage[]>([]);
  const [pageTextItems, setPageTextItems] = useState<PDFTextItem[][]>([]);
  /** {totalSheets, renderedSheets} — populated after we open the PDFs. Used to show the "Reviewing first 10 of N" banner. */
  const [pageCapInfo, setPageCapInfo] = useState<{ total: number; rendered: number } | null>(null);
  /** Discrete AI run phase — drives the live step indicator instead of a generic spinner. */
  const [aiPhase, setAiPhase] = useState<"idle" | "rendering" | "extracting_text" | "vision" | "validating" | "refining" | "saving">("idle");
  const [renderingPages, setRenderingPages] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const findingRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [findingStatuses, setFindingStatuses] = useState<Record<number, FindingStatus>>({});
  const [statusFilter, setStatusFilter] = useState<FindingStatus | "all">("all");
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>("all");
  const [disciplineFilter, setDisciplineFilter] = useState<string | "all">("all");
  const [sheetFilter, setSheetFilter] = useState<string | "all">("all");
  const [showDiff, setShowDiff] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [aiCompleteFlash, setAiCompleteFlash] = useState<number | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [repositioningIndex, setRepositioningIndex] = useState<number | null>(null);

  const handleRepositionConfirm = useCallback(async (idx: number, newMarkup: { page_index: number; x: number; y: number; width: number; height: number }) => {
    if (!review) return;
    const current = (review.ai_findings as Finding[]) || [];
    // A human-placed pin is always high confidence and must never be downgraded on reload.
    const updated = current.map((f, i) => i === idx ? {
      ...f,
      markup: {
        ...(f.markup || {}),
        ...newMarkup,
        pin_confidence: "high" as const,
        user_repositioned: true,
      },
    } : f);
    await supabase.from("plan_reviews").update({ ai_findings: JSON.parse(JSON.stringify(updated)) }).eq("id", review.id);
    queryClient.invalidateQueries({ queryKey: ["plan-review", id] });
    setRepositioningIndex(null);
    toast.success(`Pin repositioned for finding #${idx + 1}`);
  }, [review, id, queryClient]);

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

  // Auto-trigger AI check for newly created pending reviews
  const hasAutoTriggered = useRef(false);
  useEffect(() => {
    if (
      review &&
      review.ai_check_status === "pending" &&
      review.file_urls?.length > 0 &&
      !aiRunning &&
      !hasAutoTriggered.current
    ) {
      hasAutoTriggered.current = true;
      runAICheck(review);
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
      const newFilePaths: string[] = [];
      for (const file of Array.from(files)) {
        if (file.type !== "application/pdf") { toast.error(`${file.name} is not a PDF`); continue; }
        if (file.size > 20 * 1024 * 1024) { toast.error(`${file.name} exceeds 20MB limit`); continue; }
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
      const allTextItems: PDFTextItem[][] = [];
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
        // Extract real vector text + bboxes from the same pages — this is the
        // ground-truth coordinate index used to snap AI pin guesses to actual
        // visible callouts/dimensions/notes.
        let textItems: PDFTextItem[][] = [];
        try {
          textItems = await extractPagesTextItems(file, 10);
        } catch {
          textItems = images.map(() => []);
        }
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
        // Pad text items array if extraction returned fewer pages than images.
        for (let idx = 0; idx < images.length; idx++) {
          allTextItems.push(textItems[idx] || []);
        }
        setRenderProgress(((fi + 1) / r.file_urls.length) * 100);
      }
      setPageImages(allImages);
      setPageTextItems(allTextItems);
      setPageCapInfo({ total: totalSheetsAcrossFiles, rendered: renderedSheetsAcrossFiles });
      return allImages;
    } catch {
      return [];
    } finally {
      setRenderingPages(false);
    }
  };

  /**
   * Render the same PDFs at higher DPI for AI vision, with a 10×10 labelled grid
   * overlaid on each page. The model uses the visible cell labels (e.g. "H7") to
   * anchor each finding to a known coordinate cell. Returns base64 strings only,
   * in the same order as `displayImages`, so page_index lines up.
   */
  const renderVisionImages = async (r: PlanReviewRow): Promise<string[]> => {
    if (!r.file_urls || r.file_urls.length === 0) return [];
    const visionImages: string[] = [];
    for (const storedPath of r.file_urls) {
      if (!storedPath) continue;
      const filePath = storedPath.includes('/storage/v1/')
        ? storedPath.split('/documents/').pop() || storedPath
        : storedPath;
      const { data: signedData, error: signError } = await supabase.storage
        .from("documents")
        .createSignedUrl(filePath, 3600);
      if (signError || !signedData?.signedUrl) continue;
      const response = await fetch(signedData.signedUrl);
      const blob = await response.blob();
      const file = new File([blob], `vision-${filePath}`, { type: "application/pdf" });
      const base64s = await renderPDFPagesForVisionWithGrid(file, 10, 220);
      visionImages.push(...base64s);
    }
    return visionImages;
  };

  const runAICheck = async (r: PlanReviewRow) => {
    setAiRunning(true);
    setRightPanel("findings");
    setActiveFindingIndex(null);
    setAiPhase("rendering");
    try {
      // Stamp the reviewer at AI run time so we can later block self-QC.
      await supabase.from("plan_reviews").update({ ai_check_status: "running", reviewer_id: user?.id ?? null }).eq("id", r.id);

      let findings: Finding[] = [];
      const hasFiles = r.file_urls && r.file_urls.length > 0;

      if (hasFiles) {
        // Always re-render display pages first so we have provenance metadata
        // AND a vector text index to snap pins against.
        const displayImages = pageImages.length > 0 ? pageImages : await renderDocumentPages(r);
        // Pull whatever text-layer index we have (newly built or from prior render).
        const textIndex = pageTextItems;
        if (displayImages.length > 0) {
          setAiPhase("extracting_text");
          // Build the manifest BEFORE the vision render so model has full grounding.
          const imageManifest = displayImages.map((img, idx) => ({
            index: idx,
            file: img.fileName || `file-${img.fileIndex ?? 0}`,
            page_in_file: img.pageInFile ?? idx + 1,
            // Hand the model up to ~30 readable strings per page so it can pick a
            // real callout/note/dimension as `nearest_text` instead of inventing one.
            text_items: (textIndex[idx] || [])
              .filter((t) => t.text.length >= 1 && t.text.length <= 40)
              .slice(0, 30)
              .map((t) => t.text),
          }));

          setAiPhase("vision");
          // Render at 220 DPI specifically for the AI call (kept in memory only briefly).
          const visionBase64s = await renderVisionImages(r);
          const imagesForAI = visionBase64s.length === displayImages.length
            ? visionBase64s
            : displayImages.map((img) => img.base64);

          const countyConfig = getCountyRequirements(r.project?.county || "");
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
                county_requirements: {
                  hvhz: countyConfig.hvhz,
                  productApprovalFormat: countyConfig.productApprovalFormat,
                  designWindSpeed: countyConfig.designWindSpeed,
                  amendments: countyConfig.amendments,
                  cccl: countyConfig.cccl,
                },
                image_manifest: imageManifest,
                images: imagesForAI,
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
            // Model returned prose around the JSON; salvage the array.
            const match = result.match(/\[[\s\S]*\]/);
            try { findings = match ? JSON.parse(match[0]) : []; } catch { findings = []; }
          }

          setAiPhase("validating");
          // ── Validate & repair page_index, anchor pin to grid_cell, then SNAP to vector text ──
          const maxIndex = displayImages.length - 1;
          findings = findings.map((f) => {
            if (!f.markup) return f;
            const pi = f.markup.page_index;
            const pageStr = (f.page || "").trim().toLowerCase();

            // Out of range → try to remap by sheet name; otherwise drop the markup.
            if (typeof pi !== "number" || pi < 0 || pi > maxIndex) {
              if (pageStr) {
                const remap = displayImages.findIndex((img) =>
                  (img.fileName || "").toLowerCase().includes(pageStr) ||
                  pageStr.includes(`page ${img.pageInFile}`)
                );
                if (remap >= 0) {
                  return { ...f, markup: { ...f.markup, page_index: remap } };
                }
              }
              console.warn(`[ai-check] dropping out-of-range page_index=${pi} for finding "${f.code_ref}"`);
              const { markup: _drop, ...rest } = f;
              return rest as Finding;
            }

            const m = f.markup;
            const gridCell: string | undefined = typeof m.grid_cell === "string" ? m.grid_cell.trim().toUpperCase() : undefined;
            const nearestText: string = typeof m.nearest_text === "string" ? m.nearest_text.trim() : "";
            const cellCenter = gridCellToCenter(gridCell);

            // Clamp box dimensions so a misbehaving model can't paint a 50% × 50% rectangle.
            let x = Math.max(0, Math.min(98, m.x ?? 0));
            let y = Math.max(0, Math.min(98, m.y ?? 0));
            const width = Math.max(1, Math.min(15, m.width ?? 4));
            const height = Math.max(1, Math.min(10, m.height ?? 4));

            // ── Vector-text snap (precision 1% instead of 10%) ──
            // If we have a text-layer match for the model's `nearest_text` on
            // the same page, jump the pin's center to the actual text bbox
            // center. This is the single biggest precision win — we use the
            // PDF's own coordinates instead of trusting the model's eyeballed %.
            let snapped = false;
            const pageItems = textIndex[pi] || [];
            if (nearestText && pageItems.length > 0) {
              const hit = snapToNearestText(pageItems, nearestText, cellCenter);
              if (hit) {
                x = Math.max(0, Math.min(100 - width, hit.x - width / 2));
                y = Math.max(0, Math.min(100 - height, hit.y - height / 2));
                snapped = true;
              }
            }

            // If we did NOT snap to vector text but we have a valid grid cell,
            // force the BOX CENTER to sit inside that cell, clamped to ±5% of
            // the cell center. Bounds worst-case error to one grid cell (~10%).
            if (!snapped && cellCenter) {
              const desiredCx = Math.max(cellCenter.x - 5, Math.min(cellCenter.x + 5, x + width / 2));
              const desiredCy = Math.max(cellCenter.y - 5, Math.min(cellCenter.y + 5, y + height / 2));
              x = Math.max(0, Math.min(100 - width, desiredCx - width / 2));
              y = Math.max(0, Math.min(100 - height, desiredCy - height / 2));
            }

            // Confidence:
            //  - high: snapped to real text OR (grid_cell + non-empty nearest_text)
            //  - medium: grid_cell only
            //  - low: neither (raw guess)
            // (User-repositioned pins are forced to "high" elsewhere on save.)
            let pin_confidence: "high" | "medium" | "low";
            if (snapped) {
              pin_confidence = "high";
            } else if (cellCenter && nearestText.length >= 2) {
              pin_confidence = "high";
            } else if (cellCenter) {
              pin_confidence = "medium";
            } else {
              pin_confidence = "low";
            }

            return {
              ...f,
              markup: {
                ...m,
                page_index: pi,
                x,
                y,
                width,
                height,
                grid_cell: gridCell,
                nearest_text: nearestText,
                pin_confidence,
              },
            };
          });
        }
      }

      if (findings.length === 0) {
        setAiPhase("vision");
        const countyConfigFallback = getCountyRequirements(r.project?.county || "");
        const payload: Record<string, unknown> = {
          project_name: r.project?.name,
          address: r.project?.address,
          trade_type: r.project?.trade_type,
          county: r.project?.county,
          jurisdiction: r.project?.jurisdiction,
          round: r.round,
          county_requirements: {
            hvhz: countyConfigFallback.hvhz,
            productApprovalFormat: countyConfigFallback.productApprovalFormat,
            designWindSpeed: countyConfigFallback.designWindSpeed,
            amendments: countyConfigFallback.amendments,
            cccl: countyConfigFallback.cccl,
          },
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

      // ── SECOND-PASS ZOOM REFINEMENT ──
      // For findings still at medium/low pin_confidence, render a 2× zoomed
      // crop of the implicated grid cell (+ neighbors) and ask the model to
      // re-identify the element. If it returns a refined nearest_text, snap
      // again — we already have the page's text-layer index in `pageTextItems`.
      const displayImagesForRefine = pageImages.length > 0 ? pageImages : await renderDocumentPages(r);
      const refineCandidates = findings
        .map((f, i) => ({ f, i }))
        .filter(({ f }) => {
          const conf = f.markup?.pin_confidence;
          return f.markup && (conf === "medium" || conf === "low") && !!f.markup.grid_cell;
        });

      if (refineCandidates.length > 0 && displayImagesForRefine.length > 0) {
        setAiPhase("refining");
        // Cache by `${fileIndex}` to avoid re-downloading the same PDF for many findings on the same file.
        const fileCache = new Map<number, File>();
        const getFileForIndex = async (fileIndex: number): Promise<File | null> => {
          if (fileCache.has(fileIndex)) return fileCache.get(fileIndex)!;
          const storedPath = r.file_urls[fileIndex];
          if (!storedPath) return null;
          const filePath = storedPath.includes('/storage/v1/')
            ? storedPath.split('/documents/').pop() || storedPath
            : storedPath;
          const { data: signedData } = await supabase.storage.from("documents").createSignedUrl(filePath, 3600);
          if (!signedData?.signedUrl) return null;
          const blob = await (await fetch(signedData.signedUrl)).blob();
          const fileName = decodeURIComponent(filePath.split("/").pop() || `doc-${fileIndex}.pdf`);
          const file = new File([blob], fileName, { type: "application/pdf" });
          fileCache.set(fileIndex, file);
          return file;
        };

        // Limit to the first ~12 candidates so we don't blow latency on huge result sets.
        const MAX_REFINE = 12;
        const slice = refineCandidates.slice(0, MAX_REFINE);
        let upgraded = 0;
        for (const { f, i } of slice) {
          try {
            const pi = f.markup!.page_index;
            const img = displayImagesForRefine[pi];
            if (!img || img.fileIndex === undefined || img.pageInFile === undefined) continue;
            const sourceFile = await getFileForIndex(img.fileIndex);
            if (!sourceFile) continue;
            const crop = await renderZoomCropForCell(sourceFile, img.pageInFile, f.markup!.grid_cell!, 280);
            if (!crop) continue;

            const result = await callAI({
              action: "refine_finding_pin",
              payload: {
                description: f.description,
                code_ref: f.code_ref,
                grid_cell: f.markup!.grid_cell,
                original_nearest_text: f.markup!.nearest_text || "",
                images: [crop.base64],
              },
            });
            let parsed: { nearest_text?: string; x?: number; y?: number; width?: number; height?: number; found?: boolean } | null = null;
            try { parsed = JSON.parse(result); } catch {
              const m = result.match(/\{[\s\S]*\}/);
              if (m) try { parsed = JSON.parse(m[0]); } catch { parsed = null; }
            }
            if (!parsed || parsed.found === false) continue;

            // First try snapping the refined nearest_text against the vector text layer.
            const pageItems = pageTextItems[pi] || [];
            const refinedText = (parsed.nearest_text || "").trim();
            const cellCenter = gridCellToCenter(f.markup!.grid_cell);
            let snappedToText = false;
            let newX = f.markup!.x ?? 0;
            let newY = f.markup!.y ?? 0;
            const newW = f.markup!.width ?? 4;
            const newH = f.markup!.height ?? 4;

            if (refinedText && pageItems.length > 0) {
              const hit = snapToNearestText(pageItems, refinedText, cellCenter);
              if (hit) {
                newX = Math.max(0, Math.min(100 - newW, hit.x - newW / 2));
                newY = Math.max(0, Math.min(100 - newH, hit.y - newH / 2));
                snappedToText = true;
              }
            }

            // Fall back to converting the crop-relative coords back to page coords.
            if (!snappedToText && typeof parsed.x === "number" && typeof parsed.y === "number") {
              const cropPctX = Math.max(0, Math.min(100, parsed.x));
              const cropPctY = Math.max(0, Math.min(100, parsed.y));
              const pageX = crop.crop.x + (cropPctX / 100) * crop.crop.width;
              const pageY = crop.crop.y + (cropPctY / 100) * crop.crop.height;
              newX = Math.max(0, Math.min(100 - newW, pageX));
              newY = Math.max(0, Math.min(100 - newH, pageY));
            }

            findings[i] = {
              ...f,
              markup: {
                ...f.markup!,
                x: newX,
                y: newY,
                nearest_text: refinedText || f.markup!.nearest_text,
                pin_confidence: snappedToText ? "high" : "high", // refined → upgrade
              },
            };
            upgraded++;
          } catch (refineErr) {
            console.warn("[ai-check] refine pass failed for finding", i, refineErr);
          }
        }
        if (upgraded > 0) {
          console.info(`[ai-check] refined ${upgraded}/${slice.length} low-confidence pins via 2× zoom`);
        }
      }

      setAiPhase("saving");
      const prevFindings = r.ai_findings || [];

      // Stamp every finding with prompt + model version so audits work even
      // after we change prompts later. (Defensibility for FS 553.791.)
      const stampedFindings = findings.map((f) => ({
        ...f,
        prompt_version: f.prompt_version ?? "v2.2-grid+text-snap+zoom-refine",
        model_version: f.model_version ?? "google/gemini-2.5-pro",
      }));

      await supabase.from("plan_reviews").update({
        ai_check_status: "complete",
        ai_findings: JSON.parse(JSON.stringify(stampedFindings)),
        previous_findings: JSON.parse(JSON.stringify(prevFindings)),
        finding_statuses: {},
      }).eq("id", r.id);

      queryClient.invalidateQueries({ queryKey: ["plan-review", id] });
      setFindingStatuses({});
      setAiCompleteFlash(findings.length);
      setTimeout(() => setAiCompleteFlash(null), 3500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI check failed");
      await supabase.from("plan_reviews").update({ ai_check_status: "error" }).eq("id", r.id);
    } finally {
      setAiPhase("idle");
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
        })
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
          findings: r.ai_findings,
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
  // J / K       — next / prev finding
  // R           — reposition active pin
  // S           — mark resolved
  // X           — mark deferred
  // O           — mark open
  // Skip when typing in inputs/textareas; the viewer handles its own arrows/+/-/0.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const findingsList = (review?.ai_findings as Finding[] | undefined) || [];
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
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeFindingIndex, review, updateFindingStatus]);

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
    findingsCount: Array.isArray(r.ai_findings) ? (r.ai_findings as unknown as Finding[]).length : 0,
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
        aiRunning={aiRunning}
        aiCompleteFlash={aiCompleteFlash}
        hasFindings={hasFindings}
        rounds={projectRounds}
        onBack={() => navigate("/plan-review")}
        onRunAICheck={() => runAICheck(review)}
        onNavigateRound={(rid) => navigate(`/plan-review/${rid}`)}
        onNewRound={createNewRound}
      />

      {/* ── Page-cap banner: surface silent 10-page truncation honestly ── */}
      {!aiRunning && pageCapInfo && pageCapInfo.total > pageCapInfo.rendered && (
        <div className="shrink-0 border-b bg-warning/10 px-4 py-1.5 flex items-center gap-2">
          <span className="text-2xs font-semibold text-warning uppercase tracking-wide">Limited review</span>
          <span className="text-xs text-foreground/80">
            Reviewing the first <strong>{pageCapInfo.rendered}</strong> of <strong>{pageCapInfo.total}</strong> sheet{pageCapInfo.total !== 1 ? "s" : ""}.
            Findings on later sheets cannot be detected by AI in this round.
          </span>
        </div>
      )}

      {/* ── AI Scanning Overlay ── */}
      {aiRunning && (
        <div className="shrink-0 border-b bg-accent/5 px-4 py-3">
          <div className="max-w-lg space-y-2">
            {/* Real per-phase progress: shows the user we're not frozen. */}
            <div className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 text-accent animate-spin shrink-0" />
              <p className="text-xs text-accent font-medium">
                {aiPhase === "rendering" && (
                  pageCapInfo
                    ? `Rendering ${pageCapInfo.rendered} sheet${pageCapInfo.rendered !== 1 ? "s" : ""} for analysis…`
                    : "Rendering plan pages…"
                )}
                {aiPhase === "extracting_text" && "Extracting text + dimensions from PDF vector layer…"}
                {aiPhase === "vision" && "Running visual code review (this may take 60–120s)…"}
                {aiPhase === "validating" && "Snapping pins to actual callouts and validating findings…"}
                {aiPhase === "refining" && "Re-analyzing low-confidence pins at 2× zoom for precision…"}
                {aiPhase === "saving" && "Saving findings…"}
                {aiPhase === "idle" && "Preparing analysis…"}
              </p>
            </div>
            {renderingPages && (
              <Progress value={renderProgress} className="h-1" />
            )}
            <ScanTimeline currentStep={scanStep} />
          </div>
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
                {(["findings", "checklist", "completeness", "letter", "county"] as RightPanelMode[]).map((mode) => (
                  <button key={mode} onClick={() => setRightPanel(mode)} className={cn("px-3 py-1 rounded-md text-xs font-medium transition-all capitalize whitespace-nowrap", rightPanel === mode ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted/50")}>
                    {mode}
                    {mode === "findings" && hasFindings && <span className="ml-1 text-caption opacity-70">{findings.length}</span>}
                  </button>
                ))}
              </div>
              <div className="overflow-y-auto">
                {rightPanel === "findings" && (
                  <div className="p-3 space-y-2">
                    {!hasFindings && !aiRunning && (
                      <div className="flex flex-col items-center justify-center py-12 px-4">
                        {hasDocuments ? (
                          <div className="text-center space-y-3 max-w-[220px]">
                            <div className="mx-auto w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center"><Sparkles className="h-5 w-5 text-accent" /></div>
                            <p className="text-sm font-medium">Ready to analyze</p>
                            <Button size="sm" onClick={() => runAICheck(review)} className="w-full bg-accent text-accent-foreground hover:bg-accent/90"><Sparkles className="h-3.5 w-3.5 mr-1.5" /> Analyze Plans</Button>
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
                  <LetterPanel reviewId={review.id} projectId={review.project_id} projectName={review.project?.name || ""} address={review.project?.address || ""} county={county} jurisdiction={review.project?.jurisdiction || ""} tradeType={review.project?.trade_type || ""} round={review.round} aiCheckStatus={review.ai_check_status} qcStatus={review.qc_status || "pending_qc"} hasFindings={hasFindings} findings={findings} findingStatuses={findingStatuses} firmSettings={firmSettings} commentLetter={commentLetter} generatingLetter={generatingLetter} copied={copied} userId={user?.id} onGenerateLetter={() => generateCommentLetter(review)} onCancelLetter={cancelCommentLetter} onCopyLetter={copyLetter} onLetterChange={setCommentLetter} onQcApprove={async () => { await supabase.from("plan_reviews").update({ qc_status: "qc_approved", qc_reviewer_id: user?.id }).eq("id", review.id); queryClient.invalidateQueries({ queryKey: ["plan-review", id] }); toast.success("QC approved"); }} onQcReject={async () => { await supabase.from("plan_reviews").update({ qc_status: "qc_rejected", qc_reviewer_id: user?.id }).eq("id", review.id); queryClient.invalidateQueries({ queryKey: ["plan-review", id] }); toast.error("QC rejected"); }} onDocumentGenerated={() => queryClient.invalidateQueries({ queryKey: ["project-documents", review.project_id] })} />
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
                {(["findings", "checklist", "completeness", "letter", "county"] as RightPanelMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setRightPanel(mode)}
                    className={cn(
                      "px-3 py-1 rounded-md text-xs font-medium transition-all capitalize",
                      rightPanel === mode ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted/50"
                    )}
                  >
                    {mode}
                    {mode === "findings" && hasFindings && <span className="ml-1 text-caption opacity-70">{findings.length}</span>}
                  </button>
                ))}
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
                    {!hasFindings && !aiRunning && (
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
                              onClick={() => runAICheck(review)}
                              className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
                            >
                              <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Analyze Plans
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
                    onGenerateLetter={() => generateCommentLetter(review)} onCancelLetter={cancelCommentLetter}
                    onCopyLetter={copyLetter}
                    onLetterChange={setCommentLetter}
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
