/**
 * NewReviewDialog — single-form replacement for the 3-step wizard.
 *
 * Flow (no steps):
 *   1. User drops PDFs → AI title-block extraction kicks off in the background
 *      (non-blocking; populates fields when it returns).
 *   2. User picks/edits address (geocode-on-blur), use type, trade, services.
 *   3. "Create & Open" → insert project + plan_review, hand off to
 *      `uploadPlanReviewFiles` (the same helper the in-page drop zone uses),
 *      then navigate to the workspace. The pipeline stepper + StuckRecoveryBanner
 *      already live on /plan-review/:id and take it from here.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { callAI } from "@/lib/ai";
import { renderTitleBlock, validatePDFHeader, getPDFPageCount } from "@/lib/pdf-utils";
import { uploadPlanReviewFiles } from "@/lib/plan-review-upload";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Building2, Check, FileText, Home, Loader2, MapPin, Sparkles, Upload, Wind, X, ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { isHVHZ, getCountyLabel } from "@/lib/county-utils";
import { geocodeAddress } from "@/lib/geocode";

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

const MAX_TOTAL_UPLOAD_MB = 80;
const MAX_TOTAL_PAGES = 120;
const EXTRACTION_TIMEOUT_MS = 20_000;

type UseType = "commercial" | "residential";

interface UploadedFile {
  name: string;
  file: File;
  pageCount: number;
}

interface NewReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the workspace is opened. Optional. */
  onComplete?: (reviewId: string, projectId: string) => void;
  preselectedProjectId?: string;
}

export function NewReviewDialog({
  open, onOpenChange, onComplete, preselectedProjectId,
}: NewReviewDialogProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractDoneCount, setExtractDoneCount] = useState<number | null>(null);
  const [geocoding, setGeocoding] = useState(false);

  const [files, setFiles] = useState<UploadedFile[]>([]);

  // Project fields
  const [projectName, setProjectName] = useState("");
  const [address, setAddress] = useState("");
  const [county, setCounty] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [tradeType, setTradeType] = useState("building");
  const [services, setServices] = useState("plan_review");
  const [useType, setUseType] = useState<UseType | "">("");

  // Existing-project match
  const [matchedProject, setMatchedProject] = useState<{ id: string; name: string } | null>(null);
  const [useExisting, setUseExisting] = useState(!!preselectedProjectId);

  const { data: existingProjects } = useQuery({
    queryKey: ["projects-for-new-review"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  // If preselected, lock that project as the target.
  useEffect(() => {
    if (!open) return;
    if (!preselectedProjectId || !existingProjects) return;
    const m = existingProjects.find((p) => p.id === preselectedProjectId);
    if (m) {
      setMatchedProject({ id: m.id, name: m.name });
      setUseExisting(true);
    }
  }, [open, preselectedProjectId, existingProjects]);

  const reset = () => {
    setFiles([]);
    setProjectName("");
    setAddress("");
    setCounty("");
    setJurisdiction("");
    setTradeType("building");
    setServices("plan_review");
    setUseType("");
    setMatchedProject(null);
    setUseExisting(false);
    setUploading(false);
    setSaving(false);
    setExtracting(false);
    setExtractDoneCount(null);
    setGeocoding(false);
  };

  const close = () => {
    reset();
    onOpenChange(false);
  };

  const hvhz = isHVHZ(county);
  const totalPages = files.reduce((s, f) => s + f.pageCount, 0);

  // ── File intake ─────────────────────────────────────────────────────────
  const handleFiles = useCallback(async (incoming: FileList | null) => {
    if (!incoming) return;
    setUploading(true);
    try {
      const next: UploadedFile[] = [];
      for (const file of Array.from(incoming)) {
        if (!(await validatePDFHeader(file))) {
          toast.error(`${file.name} is not a valid PDF`);
          continue;
        }
        if (file.size > 50 * 1024 * 1024) {
          toast.error(`${file.name} exceeds 50MB`);
          continue;
        }
        next.push({ name: file.name, file, pageCount: await getPDFPageCount(file) });
      }
      if (next.length === 0) return;

      const totalMB =
        (files.reduce((s, f) => s + f.file.size, 0) +
          next.reduce((s, f) => s + f.file.size, 0)) /
        1024 /
        1024;
      const newTotalPages =
        files.reduce((s, f) => s + f.pageCount, 0) +
        next.reduce((s, f) => s + f.pageCount, 0);
      if (totalMB > MAX_TOTAL_UPLOAD_MB) {
        toast.error(`Upload exceeds ${MAX_TOTAL_UPLOAD_MB}MB total`);
        return;
      }
      if (newTotalPages > MAX_TOTAL_PAGES) {
        toast.error(`Upload exceeds ${MAX_TOTAL_PAGES} total pages`);
        return;
      }

      const wasEmpty = files.length === 0;
      setFiles((prev) => [...prev, ...next]);

      // Background AI auto-fill on first upload only — non-blocking. User can
      // submit before this returns.
      if (wasEmpty && !preselectedProjectId) {
        void backgroundAutoFill(next[0].file);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to read files");
    } finally {
      setUploading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, preselectedProjectId]);

  const backgroundAutoFill = useCallback(async (firstPdf: File) => {
    setExtracting(true);
    setExtractDoneCount(null);
    let timedOut = false;
    try {
      const titleBlockBase64 = await renderTitleBlock(firstPdf);
      if (!titleBlockBase64) return;
      const result = await Promise.race<string>([
        callAI({
          action: "extract_project_info",
          payload: { images: [titleBlockBase64] },
        }),
        new Promise<string>((_, reject) =>
          setTimeout(() => { timedOut = true; reject(new Error("timeout")); }, EXTRACTION_TIMEOUT_MS),
        ),
      ]);
      let extracted: Record<string, string | null> = {};
      try { extracted = JSON.parse(result); } catch { return; }

      let filledCount = 0;
      // Only fill empty fields — never clobber the user's edits while they wait.
      setProjectName((curr) => {
        if (curr.trim() || !extracted.project_name) return curr;
        filledCount++;
        return extracted.project_name;
      });
      setAddress((curr) => {
        if (curr.trim() || !extracted.address) return curr;
        filledCount++;
        return extracted.address;
      });
      setTradeType((curr) => {
        if (curr !== "building" || !extracted.trade_type) return curr;
        filledCount++;
        return extracted.trade_type;
      });

      // Geocode AI-derived address
      if (extracted.address) {
        try {
          const geo = await geocodeAddress(extracted.address);
          if (geo) {
            setCounty((c) => (c ? c : (filledCount++, geo.county)));
            if (geo.jurisdiction) setJurisdiction((j) => (j ? j : (filledCount++, geo.jurisdiction!)));
          } else {
            if (extracted.county) setCounty((c) => (c ? c : (filledCount++, extracted.county!)));
            if (extracted.jurisdiction) setJurisdiction((j) => (j ? j : (filledCount++, extracted.jurisdiction!)));
          }
        } catch { /* best-effort */ }
      }

      // Existing project match
      if (existingProjects && extracted.project_name) {
        const nameLC = extracted.project_name.toLowerCase();
        const match = existingProjects.find(
          (p) => p.name.toLowerCase().includes(nameLC) || nameLC.includes(p.name.toLowerCase()),
        );
        if (match) setMatchedProject({ id: match.id, name: match.name });
      }

      setExtractDoneCount(filledCount);
      if (filledCount > 0) {
        toast.success(`AI auto-filled ${filledCount} field${filledCount === 1 ? "" : "s"}`);
      }
      // Auto-clear the success banner after a few seconds
      setTimeout(() => setExtractDoneCount(null), 4000);
    } catch {
      if (timedOut) {
        toast.warning("Auto-fill timed out — please fill the fields manually");
      }
    } finally {
      setExtracting(false);
    }
  }, [existingProjects]);

  const removeFile = (i: number) => setFiles((prev) => prev.filter((_, idx) => idx !== i));

  const handleAddressBlur = async () => {
    if (!address || county) return;
    setGeocoding(true);
    try {
      const geo = await geocodeAddress(address);
      if (geo) {
        setCounty(geo.county);
        if (geo.jurisdiction) setJurisdiction(geo.jurisdiction);
      }
    } finally {
      setGeocoding(false);
    }
  };

  const formValid =
    files.length > 0 &&
    (useExisting
      ? !!matchedProject
      : projectName.trim() && address.trim() && county && tradeType && useType);

  // ── Submit ──────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!formValid) return;
    setSaving(true);
    try {
      let projectId: string;
      if (useExisting && matchedProject) {
        projectId = matchedProject.id;
        if (useType) {
          await supabase.from("projects").update({ use_type: useType }).eq("id", projectId);
        }
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

      const { data: review, error: revErr } = await supabase
        .from("plan_reviews")
        .insert({ project_id: projectId })
        .select("id, round")
        .single();
      if (revErr) throw revErr;

      // Hand off to the shared upload helper. We DO NOT await heavy
      // rasterization before navigating — the workspace polls page assets and
      // pipeline status itself, so the user gets there immediately.
      void uploadPlanReviewFiles({
        reviewId: review.id,
        round: review.round ?? 1,
        existingFileUrls: [],
        existingPageCount: 0,
        files: files.map((f) => f.file),
        userId: user?.id ?? null,
      })
        .then((result) => {
          for (const w of result.warnings) toast.warning(w);
          if (result.partialRasterize) {
            toast.error(
              `Only ${result.pageAssetCount}/${result.expectedPages} pages prepared. Use "Prepare pages now" in the workspace.`,
              { duration: 8000 },
            );
          } else if (result.pipelineStarted) {
            toast.success("Analysis started");
          }
          queryClient.invalidateQueries({ queryKey: ["plan-review", review.id] });
          queryClient.invalidateQueries({ queryKey: ["plan-review-page-asset-count", review.id] });
        })
        .catch((err) => {
          toast.error(err instanceof Error ? err.message : "Upload failed in background");
        });

      queryClient.invalidateQueries({ queryKey: ["plan-reviews"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });

      onComplete?.(review.id, projectId);
      close();
      navigate(`/plan-review/${review.id}`, {
        state: {
          justCreated: true,
          pendingFileCount: files.length,
          pendingPageCount: totalPages,
        },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create review");
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && close()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" aria-describedby="new-review-desc">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">New Plan Review</DialogTitle>
          <p id="new-review-desc" className="sr-only">Upload plans and create a new plan review</p>
        </DialogHeader>

        <div className="space-y-5">
          {/* Drop zone */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <div
            className={cn(
              "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all",
              uploading ? "border-accent/50 bg-accent/5" : "border-border/60 hover:border-accent/40 hover:bg-muted/20",
            )}
            onClick={() => fileInputRef.current?.click()
            }
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleFiles(e.dataTransfer.files); }}
          >
            {uploading ? (
              <Loader2 className="h-8 w-8 text-accent mx-auto mb-2 animate-spin" />
            ) : (
              <Upload className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
            )}
            <p className="text-sm font-medium">
              {uploading ? "Reading files..." : "Drop PDFs here or click to browse"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Up to {MAX_TOTAL_UPLOAD_MB}MB / {MAX_TOTAL_PAGES} pages total
            </p>
          </div>

          {files.length > 0 && (
            <div className="space-y-1.5">
              {files.map((f, i) => (
                <div key={i} className="flex items-center justify-between rounded-md border bg-card px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="h-4 w-4 text-accent shrink-0" />
                    <div className="min-w-0">
                      <span className="text-sm font-medium truncate block">{f.name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {f.pageCount} page{f.pageCount !== 1 ? "s" : ""} · {(f.file.size / 1024 / 1024).toFixed(1)}MB
                      </span>
                    </div>
                  </div>
                  <button onClick={() => removeFile(i)} className="text-muted-foreground hover:text-destructive p-1">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <p className="text-[11px] text-muted-foreground">
                {files.length} file(s) · {totalPages} pages
              </p>
            </div>
          )}

          {/* AI extraction banner — prominent so users know we're working */}
          {extracting && (
            <div className="rounded-lg border border-accent/40 bg-accent/5 p-3">
              <div className="flex items-start gap-2.5">
                <Sparkles className="h-4 w-4 text-accent shrink-0 mt-0.5 animate-pulse" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">Reading your plans…</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    AI is extracting the project name, address, county and trade from the title block. Usually 5–15 seconds — you can keep filling in fields while we work.
                  </p>
                  <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-accent/15">
                    <div className="h-full w-1/3 rounded-full bg-accent/70 animate-[slide-in-right_1.6s_ease-in-out_infinite]" />
                  </div>
                </div>
              </div>
            </div>
          )}
          {!extracting && extractDoneCount !== null && extractDoneCount > 0 && (
            <div className="rounded-lg border border-accent/40 bg-accent/5 p-3 animate-fade-in">
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-accent shrink-0" />
                <p className="text-sm font-medium text-foreground">
                  Auto-filled {extractDoneCount} field{extractDoneCount === 1 ? "" : "s"} — please review before submitting.
                </p>
              </div>
            </div>
          )}

          {/* Existing project chip */}
          {matchedProject && !preselectedProjectId && (
            <Card className={cn("border-2", useExisting ? "border-accent" : "border-border")}>
              <CardContent className="p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Building2 className="h-4 w-4 text-accent shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">Existing project found</p>
                    <p className="text-xs text-muted-foreground truncate">{matchedProject.name}</p>
                    {useExisting && (
                      <button
                        type="button"
                        onClick={() => { setUseExisting(false); setMatchedProject(null); }}
                        className="text-2xs text-muted-foreground hover:text-foreground underline mt-0.5"
                      >
                        Not this project — create new
                      </button>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={useExisting ? "default" : "outline"}
                  onClick={() => setUseExisting((v) => !v)}
                  className="shrink-0"
                >
                  {useExisting ? <><Check className="h-3 w-3 mr-1" /> Linked</> : "Link"}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Project form (hidden when linking to existing) */}
          {!useExisting && (
            <>
              {/* Use type — compact segmented control */}
              <div className="space-y-1.5">
                <Label className="text-xs">Use type *</Label>
                <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/40 p-1">
                  <button
                    type="button"
                    onClick={() => setUseType("commercial")}
                    className={cn(
                      "flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                      useType === "commercial"
                        ? "bg-card text-foreground shadow-sm ring-1 ring-accent/40"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Building2 className="h-3.5 w-3.5" /> Commercial
                  </button>
                  <button
                    type="button"
                    onClick={() => setUseType("residential")}
                    className={cn(
                      "flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                      useType === "residential"
                        ? "bg-card text-foreground shadow-sm ring-1 ring-accent/40"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Home className="h-3.5 w-3.5" /> Residential
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs">Project name *</Label>
                  <div className="relative">
                    <Input
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      placeholder={extracting && !projectName ? "AI is filling this in…" : "e.g. Palm Gardens Residence"}
                      className={cn(extracting && !projectName && "pr-8 ring-1 ring-accent/30 animate-pulse")}
                    />
                    {extracting && !projectName && (
                      <Sparkles className="h-3.5 w-3.5 text-accent absolute right-2.5 top-1/2 -translate-y-1/2 animate-pulse pointer-events-none" />
                    )}
                  </div>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs">Address *</Label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        onBlur={handleAddressBlur}
                        placeholder={extracting && !address ? "AI is filling this in…" : "123 Main St, Miami, FL"}
                        className={cn("w-full", extracting && !address && "pr-8 ring-1 ring-accent/30 animate-pulse")}
                      />
                      {extracting && !address && (
                        <Sparkles className="h-3.5 w-3.5 text-accent absolute right-2.5 top-1/2 -translate-y-1/2 animate-pulse pointer-events-none" />
                      )}
                    </div>
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
                            toast.error("Could not determine county");
                          }
                        } finally {
                          setGeocoding(false);
                        }
                      }}
                      title="Detect county & jurisdiction"
                    >
                      {geocoding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapPin className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">County *</Label>
                  <Select value={county} onValueChange={setCounty}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
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
                  <Input value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} placeholder="City of Miami" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Trade *</Label>
                  <Select value={tradeType} onValueChange={setTradeType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
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
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SERVICES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {hvhz && (
                <div className="flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3">
                  <Wind className="h-4 w-4 text-warning shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-warning-foreground">HVHZ — High Velocity Hurricane Zone</p>
                    <p className="text-xs text-muted-foreground">TAS 201/202/203, Miami-Dade NOA, ASCE 7 ≥170 mph.</p>
                  </div>
                </div>
              )}
            </>
          )}

          <Button
            onClick={handleSubmit}
            disabled={!formValid || saving}
            className="w-full h-11"
          >
            {saving ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Starting…</>
            ) : (
              <><Sparkles className="h-4 w-4 mr-2" /> Start review <ArrowRight className="h-4 w-4 ml-2" /></>
            )}
          </Button>
          <p className="text-[11px] text-center text-muted-foreground leading-relaxed">
            We'll keep uploading in the workspace — keep this browser open for ~30 sec, then it's safe to leave.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
