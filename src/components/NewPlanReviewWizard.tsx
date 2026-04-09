import { useState, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { callAI } from "@/lib/ai";
import { renderTitleBlock, validatePDFHeader, getPDFPageCount } from "@/lib/pdf-utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  { id: 3, label: "Launch", icon: Sparkles },
];

interface UploadedFile {
  name: string;
  url: string;
  file: File;
  pageCount: number;
}

interface NewPlanReviewWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: (reviewId: string) => void;
  preselectedProjectId?: string;
}

export function NewPlanReviewWizard({ open, onOpenChange, onComplete, preselectedProjectId }: NewPlanReviewWizardProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState(0);
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
  const [aiExtracted, setAiExtracted] = useState(false);

  // Existing project match
  const [matchedProject, setMatchedProject] = useState<{ id: string; name: string } | null>(null);
  const [useExisting, setUseExisting] = useState(false);

  // Created IDs
  const [createdReviewId, setCreatedReviewId] = useState("");

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
    setAiExtracted(false);
    setMatchedProject(null);
    setUseExisting(false);
    setCreatedReviewId("");
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
        if (file.size > 20 * 1024 * 1024) {
          toast.error(`${file.name} exceeds 20MB limit`);
          continue;
        }
        const pageCount = await getPDFPageCount(file);
        newFiles.push({ name: file.name, url: "", file, pageCount });
      }

      if (newFiles.length > 0) {
        setUploadedFiles((prev) => [...prev, ...newFiles]);
        toast.success(`${newFiles.length} file(s) added`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to process files");
    } finally {
      setUploading(false);
    }
  }, []);

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

      // Call AI to extract info
      const result = await callAI({
        action: "extract_project_info",
        payload: { images: [titleBlockBase64] },
      });

      setExtractProgress(90);

      let extracted: Record<string, string | null> = {};
      try {
        extracted = JSON.parse(result);
      } catch {
        toast.error("Could not parse AI extraction result");
        setExtracting(false);
        return;
      }

      // Pre-fill fields
      if (extracted.project_name) setProjectName(extracted.project_name);
      if (extracted.address) setAddress(extracted.address);
      if (extracted.county) setCounty(extracted.county);
      if (extracted.jurisdiction) setJurisdiction(extracted.jurisdiction);
      if (extracted.trade_type) setTradeType(extracted.trade_type);
      if (extracted.architect) setArchitect(extracted.architect);
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
      toast.success("Project details extracted from plans");
      setStep(2);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI extraction failed");
    } finally {
      setExtracting(false);
    }
  }, [uploadedFiles, existingProjects]);

  // --- Skip extraction, go to manual entry ---
  const skipExtraction = () => {
    setStep(2);
  };

  // --- Create project & review ---
  const step2Valid = !!(projectName && address && county && tradeType);

  const handleLaunch = async () => {
    setSaving(true);
    try {
      let projectId: string;

      if (useExisting && matchedProject) {
        projectId = matchedProject.id;
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

      // Upload files to storage
      const fileUrls: string[] = [];
      for (const uf of uploadedFiles) {
        const path = `plan-reviews/${review.id}/${uf.name}`;
        const { error: uploadError } = await supabase.storage
          .from("documents")
          .upload(path, uf.file, { upsert: true });
        if (uploadError) {
          console.error("Upload error:", uploadError);
          continue;
        }
        // Store the path, not a public URL — bucket is private
        fileUrls.push(path);
      }

      // Update plan_review with file URLs
      if (fileUrls.length > 0) {
        await supabase
          .from("plan_reviews")
          .update({ file_urls: fileUrls })
          .eq("id", review.id);
      }

      queryClient.invalidateQueries({ queryKey: ["plan-reviews"] });
      onComplete(review.id);
      handleClose();
      toast.success("Review created — ready for AI analysis");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create review");
    } finally {
      setSaving(false);
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
              <p className="text-xs text-muted-foreground mt-1">PDF files up to 20MB each • Header validation enabled</p>
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
                className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90"
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
                  <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. 123 Main St, Miami, FL" />
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
                </div>
              </CardContent>
            </Card>

            <Button
              onClick={handleLaunch}
              disabled={(!useExisting && !step2Valid) || saving}
              className="w-full h-12 bg-accent text-accent-foreground hover:bg-accent/90"
            >
              {saving ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating...</>
              ) : (
                <><Sparkles className="h-4 w-4 mr-2" /> Create Review & Open Workspace</>
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
