import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { callAI } from "@/lib/ai";
import { renderTitleBlock, renderPDFPagesToJpegs, validatePDFHeader, getPDFPageCount } from "@/lib/pdf-utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from "@/components/ui/select";
import {
 Dialog,
 DialogContent,
 DialogHeader,
 DialogTitle,
} from "@/components/ui/dialog";
import {
 ArrowLeft,
 ArrowRight,
 Building2,
 Check,
 FileText,
 Home,
 Loader2,
 MapPin,
 Sparkles,
 Upload,
 Wind,
 X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { isHVHZ, getCountyLabel } from "@/lib/county-utils";
import { geocodeAddress } from "@/lib/geocode";
import { PipelineProgressStepper } from "@/components/plan-review/PipelineProgressStepper";

const FLORIDA_COUNTIES = [
 "miami-dade", "broward", "palm-beach", "hillsborough", "orange", "duval",
 "pinellas", "lee", "brevard", "volusia", "sarasota", "manatee", "collier",
 "polk", "seminole", "pasco", "osceola", "st-lucie", "escambia", "marion",
 "alachua", "leon", "clay", "st-johns", "okaloosa", "hernando", "charlotte",
 "citrus", "indian-river", "martin",
];

const TRADE_TYPES = [
 { value: "building", label: "Building (General)" },
 { value: "structural", label: "Structural" },
 { value: "mechanical", label: "Mechanical" },
 { value: "electrical", label: "Electrical" },
 { value: "plumbing", label: "Plumbing" },
 { value: "roofing", label: "Roofing" },
 { value: "fire", label: "Fire Protection" },
];

const SERVICES = [
 { value: "plan_review", label: "Plan Review" },
 { value: "inspections", label: "Inspections" },
 { value: "both", label: "Plan Review + Inspections" },
];

const STEPS = [
 { id: 1, label: "Upload", icon: Upload },
 { id: 2, label: "Confirm", icon: Check },
 { id: 3, label: "Analyze", icon: Sparkles },
];

type UseType = "commercial" | "residential";

// Aggregate upload guardrails. Each PDF page costs ~1.5–2s of MuPDF WASM
// cold-start + encode time on a fresh edge worker. Cap totals so a review
// never accidentally schedules a multi-hour pipeline run.
const MAX_TOTAL_UPLOAD_MB = 80;
const MAX_TOTAL_PAGES = 120;
// AI title-block extraction is best-effort. If the `ai` edge function is
// slow or failing, fall back to manual entry instead of hanging Step 1.
const EXTRACTION_TIMEOUT_MS = 20_000;
const CLIENT_PAGE_RASTER_DPI = 96;
const CLIENT_PAGE_RASTER_QUALITY = 0.72;

interface UploadedFile {
 name: string;
 url: string;
 file: File;
 pageCount: number;
}

interface NewPlanReviewWizardProps {
 open: boolean;
 onOpenChange: (open: boolean) => void;
 onComplete: (reviewId: string, projectId: string) => void;
 preselectedProjectId?: string;
}

export function NewPlanReviewWizard({ open, onOpenChange, onComplete, preselectedProjectId }: NewPlanReviewWizardProps) {
 const queryClient = useQueryClient();
 const navigate = useNavigate();
 const [step, setStep] = useState(1);
 const [saving, setSaving] = useState(false);
 const [uploading, setUploading] = useState(false);
 const [extracting, setExtracting] = useState(false);
 const [extractProgress, setExtractProgress] = useState(0);
 const [geocoding, setGeocoding] = useState(false);
 const fileInputRef = useRef<HTMLInputElement>(null);

 // Upload state
 const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);

 // Extracted / editable project fields
 const [projectName, setProjectName] = useState("");
 const [address, setAddress] = useState("");
 const [county, setCounty] = useState("");
 const [jurisdiction, setJurisdiction] = useState("");
 const [tradeType, setTradeType] = useState("");
 const [services, setServices] = useState("plan_review");
 const [architect, setArchitect] = useState("");
 const [useType, setUseType] = useState<UseType | "">("");
 const [aiExtracted, setAiExtracted] = useState(false);

 // Existing project match
 const [matchedProject, setMatchedProject] = useState<{ id: string; name: string } | null>(null);
 const [useExisting, setUseExisting] = useState(false);

 // Created IDs
 const [createdReviewId, setCreatedReviewId] = useState("");
 const [createdProjectId, setCreatedProjectId] = useState("");
 const [pipelineError, setPipelineError] = useState<string | null>(null);
 const [retrying, setRetrying] = useState(false);

 const { data: existingProjects } = useQuery({
 queryKey: ["projects-for-wizard"],
 queryFn: async () => {
 const { data, error } = await supabase
 .from("projects")
 .select("id, name, address, county, jurisdiction, trade_type, services")
 .order("name");
 if (error) throw error;
 return data;
 },
 enabled: open,
 });

 const hvhz = isHVHZ(county);

 const resetState = () => {
 setStep(1);
 setUploadedFiles([]);
 setProjectName("");
 setAddress("");
 setCounty("");
 setJurisdiction("");
 setTradeType("");
 setServices("plan_review");
 setArchitect("");
 setUseType("");
 setAiExtracted(false);
 setMatchedProject(null);
 setUseExisting(false);
 setCreatedReviewId("");
 setCreatedProjectId("");
 setPipelineError(null);
 setRetrying(false);
 setExtracting(false);
 setExtractProgress(0);
 };

 const handleClose = () => {
 resetState();
 onOpenChange(false);
 };

 // --- File Upload & AI Extraction ---
 const handleFileUpload = useCallback(async (files: FileList | null) => {
 if (!files) return;
 setUploading(true);

 try {
 const newFiles: UploadedFile[] = [];
 for (const file of Array.from(files)) {
 // Validate PDF header
 const isValid = await validatePDFHeader(file);
 if (!isValid) {
 toast.error(`${file.name} is not a valid PDF file`);
 continue;
 }
        if (file.size > 50 * 1024 * 1024) {
          toast.error(`${file.name} exceeds 50MB limit`);
          continue;
        }
 const pageCount = await getPDFPageCount(file);
 newFiles.push({ name: file.name, url: "", file, pageCount });
 }

        if (newFiles.length > 0) {
          // Aggregate guardrails: total bytes + total pages across the whole
          // upload. Reject the *new batch* if adding it would exceed limits,
          // so the user keeps whatever was already validated.
          const existingBytes = uploadedFiles.reduce((s, f) => s + f.file.size, 0);
          const existingPages = uploadedFiles.reduce((s, f) => s + f.pageCount, 0);
          const newBytes = newFiles.reduce((s, f) => s + f.file.size, 0);
          const newPages = newFiles.reduce((s, f) => s + f.pageCount, 0);
          const totalMB = (existingBytes + newBytes) / 1024 / 1024;
          const totalPages = existingPages + newPages;

          if (totalMB > MAX_TOTAL_UPLOAD_MB) {
            toast.error(
              `Upload exceeds ${MAX_TOTAL_UPLOAD_MB}MB total (${totalMB.toFixed(1)}MB). Remove a file or split the submission.`,
            );
            return;
          }
          if (totalPages > MAX_TOTAL_PAGES) {
            toast.error(
              `Upload exceeds ${MAX_TOTAL_PAGES} total pages (${totalPages}). Split this submission into smaller batches.`,
            );
            return;
          }

          setUploadedFiles((prev) => [...prev, ...newFiles]);
          toast.success(`${newFiles.length} file(s) added`);
        }
 } catch (err) {
 toast.error(err instanceof Error ? err.message : "Failed to process files");
 } finally {
 setUploading(false);
 }
 }, [uploadedFiles]);

 const removeFile = (index: number) => {
 setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
 };

 // --- Extract project info from title block ---
 const extractProjectInfo = useCallback(async () => {
 if (uploadedFiles.length === 0) return;
 setExtracting(true);
 setExtractProgress(10);

 try {
 // Render title block of first PDF
 setExtractProgress(30);
 const titleBlockBase64 = await renderTitleBlock(uploadedFiles[0].file);
 setExtractProgress(60);

 if (!titleBlockBase64) {
 toast.error("Could not render PDF page for extraction");
 setExtracting(false);
 return;
 }

      // Call AI to extract info. Wrap in a hard timeout so a slow/failing
      // `ai` edge function can never strand the user on Step 1 — they can
      // always fall through to manual entry.
      const result = await Promise.race<string>([
        callAI({
          action: "extract_project_info",
          payload: { images: [titleBlockBase64] },
        }),
        new Promise<string>((_, reject) =>
          setTimeout(
            () => reject(new Error("AI extraction timed out")),
            EXTRACTION_TIMEOUT_MS,
          ),
        ),
      ]);

 setExtractProgress(90);

 let extracted: Record<string, string | null> = {};
 try {
 extracted = JSON.parse(result);
 } catch {
        toast.error("Could not parse AI extraction result — please fill in manually");
        setExtracting(false);
        setStep(2);
        return;
 }

 // Pre-fill fields
 if (extracted.project_name) setProjectName(extracted.project_name);
 const extractedAddress = extracted.address || "";
 if (extractedAddress) setAddress(extractedAddress);
 if (extracted.trade_type) setTradeType(extracted.trade_type);
 if (extracted.architect) setArchitect(extracted.architect);

 // Geocode the address to auto-determine county + jurisdiction (overrides AI guess)
 let geocoded = false;
 if (extractedAddress) {
 const geo = await geocodeAddress(extractedAddress);
 if (geo) {
 setCounty(geo.county);
 if (geo.jurisdiction) setJurisdiction(geo.jurisdiction);
 geocoded = true;
 }
 }
 // Fall back to AI-extracted county/jurisdiction only if geocoding failed
 if (!geocoded) {
 if (extracted.county) setCounty(extracted.county);
 if (extracted.jurisdiction) setJurisdiction(extracted.jurisdiction);
 }
 setAiExtracted(true);

 // Check for existing project match
 if (existingProjects && extracted.project_name) {
 const nameLC = extracted.project_name.toLowerCase();
 const match = existingProjects.find(
 (p) => p.name.toLowerCase().includes(nameLC) || nameLC.includes(p.name.toLowerCase())
 );
 if (match) setMatchedProject({ id: match.id, name: match.name });
 }

 setExtractProgress(100);
 toast.success(geocoded ? "Project details extracted & address geocoded" : "Project details extracted");
 setStep(2);
 } catch (err) {
        const msg = err instanceof Error ? err.message : "AI extraction failed";
        // On timeout / AI errors, fall through to manual entry instead of
        // stranding the user on Step 1 with no clear path forward.
        toast.error(`${msg} — please fill in details manually`);
        setStep(2);
 } finally {
 setExtracting(false);
 }
 }, [uploadedFiles, existingProjects]);

 // --- Skip extraction, go to manual entry ---
 const skipExtraction = () => {
 setStep(2);
 };

 // Step 2 is valid only when use_type is also picked.
 const step2Valid = !!(projectName && address && county && tradeType && useType);

 // --- Kick off the pipeline (extracted so the Retry button can re-use it) ---
 const invokePipeline = async (planReviewId: string) => {
   const { error } = await supabase.functions.invoke("run-review-pipeline", {
     body: { plan_review_id: planReviewId },
   });
   if (error) throw error;
 };

 const handleLaunch = async () => {
 setSaving(true);
 setPipelineError(null);
 try {
 let projectId: string;

 if (useExisting && matchedProject) {
 projectId = matchedProject.id;
 // Update use_type on the existing project so the pipeline can read it.
 await supabase
   .from("projects")
   .update({ use_type: useType || null })
   .eq("id", projectId);
 } else {
 const serviceArray = services === "both" ? ["plan_review", "inspections"] : [services];
 const { data: proj, error: projErr } = await supabase
 .from("projects")
 .insert({
 name: projectName,
 address,
 county,
 jurisdiction,
 trade_type: tradeType,
 services: serviceArray,
 use_type: useType || null,
 status: "plan_review" as const,
 })
 .select("id")
 .single();
 if (projErr) throw projErr;
 projectId = proj.id;
 }

 // Create plan_review record
 const { data: review, error: revErr } = await supabase
 .from("plan_reviews")
 .insert({ project_id: projectId })
 .select("id")
 .single();
 if (revErr) throw revErr;

 setCreatedReviewId(review.id);
 setCreatedProjectId(projectId);

  // Upload files to storage
 const fileUrls: string[] = [];
  const pageAssetRows: Array<{
    plan_review_id: string;
    source_file_path: string;
    page_index: number;
    storage_path: string;
    status: "ready";
  }> = [];
  let nextGlobalPageIndex = 0;
 for (const uf of uploadedFiles) {
 const path = `plan-reviews/${review.id}/${uf.name}`;
 const { error: uploadError } = await supabase.storage
 .from("documents")
 .upload(path, uf.file, { upsert: true });
 if (uploadError) {
 toast.error(`Failed to upload ${uf.name}: ${uploadError.message}`);
 continue;
 }
 // Store the path, not a public URL — bucket is private
 fileUrls.push(path);

  if (uf.file.type === "application/pdf" || uf.name.toLowerCase().endsWith(".pdf")) {
    const pageJpegs = await renderPDFPagesToJpegs(
      uf.file,
      uf.pageCount,
      CLIENT_PAGE_RASTER_DPI,
      CLIENT_PAGE_RASTER_QUALITY,
    );
    for (const page of pageJpegs) {
      const pagePath = `plan-reviews/${review.id}/pages/${uf.name.replace(/\.pdf$/i, "")}/p-${String(page.pageIndex).padStart(3, "0")}.jpg`;
      const { error: pageUploadError } = await supabase.storage
        .from("documents")
        .upload(pagePath, page.blob, { upsert: true, contentType: "image/jpeg" });
      if (pageUploadError) {
        throw new Error(`Failed to upload page ${page.pageIndex + 1} for ${uf.name}: ${pageUploadError.message}`);
      }
      pageAssetRows.push({
        plan_review_id: review.id,
        source_file_path: path,
        page_index: nextGlobalPageIndex,
        storage_path: pagePath,
        status: "ready",
      });
      nextGlobalPageIndex += 1;
    }
  }
 }

  // Update plan_review with file URLs
 if (fileUrls.length > 0) {
 await supabase
 .from("plan_reviews")
 .update({ file_urls: fileUrls })
 .eq("id", review.id);

 // Also insert into plan_review_files so the pipeline can find them
 const { data: { user } } = await supabase.auth.getUser();
 const { error: prfErr } = await supabase.from("plan_review_files").insert(
 fileUrls.map((fp) => ({
 plan_review_id: review.id,
 file_path: fp,
 round: 1,
 uploaded_by: user?.id ?? null,
 })),
 );
 if (prfErr) {
 toast.error(`Failed to register files for pipeline: ${prfErr.message}`);
 }

  if (pageAssetRows.length > 0) {
    const { error: assetErr } = await supabase
      .from("plan_review_page_assets")
      .upsert(pageAssetRows, { onConflict: "plan_review_id,page_index" });
    if (assetErr) {
      throw new Error(`Failed to register prepared pages: ${assetErr.message}`);
    }
  }
 }

 queryClient.invalidateQueries({ queryKey: ["plan-reviews"] });
 queryClient.invalidateQueries({ queryKey: ["projects"] });

 // Move to step 3 BEFORE invoking — the realtime stepper subscribes immediately.
 setStep(3);

 // Await the trigger so we can surface 401/500 startup failures (auth, missing
 // service role, CORS preflight rejection) immediately as `pipelineError`
 // instead of leaving the user staring at a "Pending" stepper forever.
 // The function returns 202 quickly after kicking off background work, so
 // awaiting here does not block the UI for the full pipeline duration.
 try {
   await invokePipeline(review.id);
   toast.success("Review created — analysis started");
 } catch (err) {
   const msg = err instanceof Error ? err.message : "Pipeline failed to start";
   setPipelineError(msg);
   toast.error(`Analysis failed to start: ${msg}`);
 }
 } catch (err) {
 toast.error(err instanceof Error ? err.message : "Failed to create review");
 } finally {
 setSaving(false);
 }
 };

 // --- Pipeline complete handler (auto-route to workspace) ---
 const handlePipelineComplete = useCallback(() => {
   if (!createdReviewId || !createdProjectId) return;
   onComplete(createdReviewId, createdProjectId);
   handleClose();
   toast.success("Analysis complete — opening workspace");
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [createdReviewId, createdProjectId]);

 const handleContinueInBackground = () => {
   if (createdReviewId && createdProjectId) {
     // Keep the pipeline running; just close the dialog. The toast lets the
     // reviewer know it's still working in the background.
     toast.info(`Analyzing ${projectName}…`, {
       description: "We'll keep working in the background.",
       action: {
         label: "Open workspace",
         onClick: () => navigate(`/plan-review/${createdReviewId}`),
       },
       duration: 8000,
     });
   }
   handleClose();
 };

 const handleOpenWorkspaceNow = () => {
   if (!createdReviewId || !createdProjectId) return;
   onComplete(createdReviewId, createdProjectId);
   handleClose();
 };

 const handleRetryPipeline = async () => {
   if (!createdReviewId) return;
   setRetrying(true);
   setPipelineError(null);
   try {
     await invokePipeline(createdReviewId);
     toast.success("Retrying analysis…");
   } catch (err) {
     setPipelineError(err instanceof Error ? err.message : "Retry failed");
   } finally {
     setRetrying(false);
   }
 };

 const totalPages = uploadedFiles.reduce((sum, f) => sum + f.pageCount, 0);

 return (
 <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
 <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" aria-describedby="wizard-desc">
 <DialogHeader>
 <DialogTitle className="text-lg font-semibold">
 New Plan Review
 </DialogTitle>
 <p id="wizard-desc" className="sr-only">Upload plans and create a new plan review</p>
 </DialogHeader>

 {/* Step indicators */}
 <div className="flex items-center gap-2 mb-6">
 {STEPS.map((s, i) => {
 const Icon = s.icon;
 const active = step === s.id;
 const done = step > s.id;
 return (
 <div key={s.id} className="flex items-center gap-2">
 {i > 0 && (
 <div className={cn("h-px w-8", done ? "bg-accent" : "bg-border")} />
 )}
 <div
 className={cn(
 "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
 active && "bg-accent text-accent-foreground",
 done && "bg-accent/15 text-accent",
 !active && !done && "bg-muted text-muted-foreground"
 )}
 >
 {done ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
 {s.label}
 </div>
 </div>
 );
 })}
 </div>

 {/* ===== STEP 1: Upload Plans ===== */}
 {step === 1 && (
 <div className="space-y-5">
 <div className="text-center py-2">
 <p className="text-sm font-medium">Upload your plan documents</p>
 <p className="text-xs text-muted-foreground mt-1">
 AI will extract project details from the title block automatically
 </p>
 </div>

 <input
 ref={fileInputRef}
 type="file"
 accept=".pdf"
 multiple
 className="hidden"
 onChange={(e) => handleFileUpload(e.target.files)}
 />

 {/* Drop zone */}
 <div
 className={cn(
 "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all",
 uploading ? "border-accent/50 bg-accent/5" : "border-border/60 hover:border-accent/40 hover:bg-muted/20"
 )}
 onClick={() => fileInputRef.current?.click()}
 onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
 onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleFileUpload(e.dataTransfer.files); }}
 >
 {uploading ? (
 <Loader2 className="h-10 w-10 text-accent mx-auto mb-3 animate-spin" />
 ) : (
 <Upload className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
 )}
 <p className="text-sm font-medium">
 {uploading ? "Processing..." : "Drop PDF files here or click to browse"}
 </p>
 <p className="text-xs text-muted-foreground mt-1">PDF files up to 50MB each • Header validation enabled</p>
 </div>

 {/* File list */}
 {uploadedFiles.length > 0 && (
 <div className="space-y-2">
 {uploadedFiles.map((f, i) => (
 <div
 key={i}
 className="flex items-center justify-between rounded-lg border bg-card px-3 py-2.5 animate-in fade-in slide-in-from-bottom-1"
 style={{ animationDelay: `${i * 50}ms` }}
 >
 <div className="flex items-center gap-2.5 min-w-0">
 <FileText className="h-4 w-4 text-accent shrink-0" />
 <div className="min-w-0">
 <span className="text-sm font-medium truncate block">{f.name}</span>
 <span className="text-[10px] text-muted-foreground">
 {f.pageCount} page{f.pageCount !== 1 ? "s" : ""} • {(f.file.size / 1024 / 1024).toFixed(1)}MB
 </span>
 </div>
 </div>
 <button onClick={() => removeFile(i)} className="text-muted-foreground hover:text-destructive p-1">
 <X className="h-3.5 w-3.5" />
 </button>
 </div>
 ))}
 <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
 <FileText className="h-3 w-3" />
 <span>{uploadedFiles.length} file(s) • {totalPages} total pages</span>
 </div>
 </div>
 )}

 {/* Extraction progress */}
 {extracting && (
 <div className="space-y-2">
 <div className="flex items-center gap-2 text-xs text-accent">
 <Sparkles className="h-3.5 w-3.5 animate-pulse" />
 <span>AI is reading your title block...</span>
 </div>
 <Progress value={extractProgress} className="h-1.5" />
 </div>
 )}

 {/* Action buttons */}
 <div className="flex gap-3">
 <Button
 variant="outline"
 onClick={skipExtraction}
 disabled={extracting}
 className="flex-1"
 >
 Enter manually
 </Button>
 <Button
 onClick={extractProjectInfo}
 disabled={uploadedFiles.length === 0 || extracting}
 className="flex-1"
 >
 {extracting ? (
 <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Extracting...</>
 ) : (
 <><Sparkles className="h-4 w-4 mr-2" /> Extract & Continue</>
 )}
 </Button>
 </div>
 </div>
 )}

 {/* ===== STEP 2: Confirm Details ===== */}
 {step === 2 && (
 <div className="space-y-5">
 <button
 onClick={() => setStep(1)}
 className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
 >
 <ArrowLeft className="h-3 w-3" /> Back to upload
 </button>

 {/* Use type — required, drives which FBC code path the AI follows */}
 <div className="space-y-2">
   <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
     Project use type *
   </Label>
   <div className="grid grid-cols-2 gap-3">
     <button
       type="button"
       onClick={() => setUseType("commercial")}
       className={cn(
         "flex flex-col items-start gap-1 rounded-lg border-2 p-4 text-left transition-all hover:border-accent/60",
         useType === "commercial"
           ? "border-accent bg-accent/5"
           : "border-border bg-card",
       )}
     >
       <div className="flex w-full items-center justify-between">
         <Building2 className={cn("h-5 w-5", useType === "commercial" ? "text-accent" : "text-muted-foreground")} />
         {useType === "commercial" && <Check className="h-4 w-4 text-accent" />}
       </div>
       <p className="text-sm font-semibold">Commercial</p>
       <p className="text-xs text-muted-foreground">FBC Building, accessibility, life safety</p>
     </button>
     <button
       type="button"
       onClick={() => setUseType("residential")}
       className={cn(
         "flex flex-col items-start gap-1 rounded-lg border-2 p-4 text-left transition-all hover:border-accent/60",
         useType === "residential"
           ? "border-accent bg-accent/5"
           : "border-border bg-card",
       )}
     >
       <div className="flex w-full items-center justify-between">
         <Home className={cn("h-5 w-5", useType === "residential" ? "text-accent" : "text-muted-foreground")} />
         {useType === "residential" && <Check className="h-4 w-4 text-accent" />}
       </div>
       <p className="text-sm font-semibold">Residential</p>
       <p className="text-xs text-muted-foreground">1 & 2 family, FBC Residential (FBCR)</p>
     </button>
   </div>
 </div>

 {aiExtracted && (
 <div className="flex items-center gap-2 rounded-lg bg-accent/10 border border-accent/20 px-3 py-2">
 <Sparkles className="h-4 w-4 text-accent shrink-0" />
 <p className="text-xs text-accent">
 Details extracted by AI — review and correct if needed
 </p>
 </div>
 )}

 {/* Existing project match */}
 {matchedProject && (
 <Card className={cn("border-2 transition-colors", useExisting ? "border-accent" : "border-border")}>
 <CardContent className="p-4">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <Building2 className="h-4 w-4 text-accent" />
 <div>
 <p className="text-sm font-medium">Existing project found</p>
 <p className="text-xs text-muted-foreground">{matchedProject.name}</p>
 </div>
 </div>
 <Button
 size="sm"
 variant={useExisting ? "default" : "outline"}
 onClick={() => setUseExisting(!useExisting)}
 className={useExisting ? "bg-accent text-accent-foreground" : ""}
 >
 {useExisting ? <><Check className="h-3 w-3 mr-1" /> Linked</> : "Use this project"}
 </Button>
 </div>
 </CardContent>
 </Card>
 )}

 {/* Project form */}
 {!useExisting && (
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
 <div className="space-y-1.5">
 <Label className="text-xs">Project Name *</Label>
 <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="e.g. Palm Gardens Residential" />
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs">Address *</Label>
 <div className="flex gap-2">
 <Input
 value={address}
 onChange={(e) => setAddress(e.target.value)}
 placeholder="e.g. 123 Main St, Miami, FL"
 className="flex-1"
 />
 <Button
 type="button"
 variant="outline"
 size="sm"
 disabled={!address || geocoding}
 onClick={async () => {
 setGeocoding(true);
 try {
 const geo = await geocodeAddress(address);
 if (geo) {
 setCounty(geo.county);
 if (geo.jurisdiction) setJurisdiction(geo.jurisdiction);
 toast.success(`Detected ${geo.countyLabel} County${geo.jurisdiction ? ` — ${geo.jurisdiction}` : ""}`);
 } else {
 toast.error("Could not determine county from address");
 }
 } finally {
 setGeocoding(false);
 }
 }}
 title="Auto-detect county & jurisdiction"
 >
 {geocoding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapPin className="h-3.5 w-3.5" />}
 </Button>
 </div>
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs">County *</Label>
 <Select value={county} onValueChange={setCounty}>
 <SelectTrigger><SelectValue placeholder="Select county" /></SelectTrigger>
 <SelectContent>
 {FLORIDA_COUNTIES.map((c) => (
 <SelectItem key={c} value={c}>
 <span className="flex items-center gap-2">
 {getCountyLabel(c)}
 {isHVHZ(c) && <Wind className="h-3 w-3 text-destructive" />}
 </span>
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs">Jurisdiction</Label>
 <Input value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} placeholder="e.g. City of Miami" />
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs">Trade Type *</Label>
 <Select value={tradeType} onValueChange={setTradeType}>
 <SelectTrigger><SelectValue placeholder="Select trade" /></SelectTrigger>
 <SelectContent>
 {TRADE_TYPES.map((t) => (
 <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs">Services</Label>
 <Select value={services} onValueChange={setServices}>
 <SelectTrigger><SelectValue placeholder="Select services" /></SelectTrigger>
 <SelectContent>
 {SERVICES.map((s) => (
 <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 {architect && (
 <div className="space-y-1.5 sm:col-span-2">
 <Label className="text-xs">Architect / Engineer of Record</Label>
 <Input value={architect} onChange={(e) => setArchitect(e.target.value)} />
 </div>
 )}
 </div>
 )}

 {/* HVHZ warning */}
 {hvhz && (
 <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
 <Wind className="h-5 w-5 text-destructive shrink-0" />
 <div>
 <p className="text-sm font-semibold text-destructive">HVHZ — High Velocity Hurricane Zone</p>
 <p className="text-xs text-destructive/80">Enhanced requirements apply (TAS 201/202/203, Miami-Dade NOA, ASCE 7 ≥170 mph).</p>
 </div>
 </div>
 )}

 {/* Summary */}
 <Card className="border shadow-subtle">
 <CardContent className="p-4 space-y-2">
 <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Review Summary</p>
 <div className="grid grid-cols-2 gap-2 text-sm">
 <span className="text-muted-foreground">Documents</span>
 <span className="font-medium">{uploadedFiles.length} PDF(s) • {totalPages} pages</span>
 {county && (
 <>
 <span className="text-muted-foreground">County</span>
 <span className="font-medium flex items-center gap-1">
 {getCountyLabel(county)}
 {hvhz && <Wind className="h-3 w-3 text-destructive" />}
 </span>
 </>
 )}
 {useType && (
 <>
 <span className="text-muted-foreground">Use type</span>
 <span className="font-medium capitalize">{useType}</span>
 </>
 )}
 </div>
 </CardContent>
 </Card>

 <Button
 onClick={handleLaunch}
 disabled={(!useExisting && !step2Valid) || !useType || saving}
 className="w-full h-12"
 >
 {saving ? (
 <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating...</>
 ) : (
 <><Sparkles className="h-4 w-4 mr-2" /> Create & Analyze <ArrowRight className="h-4 w-4 ml-2" /></>
 )}
 </Button>
 </div>
 )}

 {/* ===== STEP 3: Analyzing ===== */}
 {step === 3 && createdReviewId && (
   <div className="space-y-5">
     <div className="text-center py-2">
       <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-accent/10 mb-3">
         <Sparkles className="h-6 w-6 text-accent animate-pulse" />
       </div>
       <p className="text-sm font-semibold">Analyzing your plans</p>
       <p className="text-xs text-muted-foreground mt-1">
         {projectName ? `${projectName} · ` : ""}{useType === "residential" ? "FBCR" : "FBC"} review in progress
       </p>
     </div>

     {pipelineError && (
       <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
         <p className="text-sm font-semibold text-destructive">Analysis failed to start</p>
         <p className="text-xs text-destructive/80">{pipelineError}</p>
         <Button
           size="sm"
           variant="outline"
           onClick={handleRetryPipeline}
           disabled={retrying}
           className="border-destructive/40 text-destructive hover:bg-destructive/10"
         >
           {retrying ? (
             <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Retrying…</>
           ) : (
             "Retry analysis"
           )}
         </Button>
       </div>
     )}

     <div className="rounded-lg border bg-card p-4">
       <PipelineProgressStepper
         planReviewId={createdReviewId}
         onComplete={handlePipelineComplete}
       />
     </div>

     <div className="flex gap-3">
       <Button
         variant="outline"
         onClick={handleContinueInBackground}
         className="flex-1"
       >
         Continue in background
       </Button>
       <Button
         onClick={handleOpenWorkspaceNow}
         className="flex-1"
       >
         Open workspace
       </Button>
     </div>
   </div>
 )}
 </DialogContent>
 </Dialog>
 );
}
