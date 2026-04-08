import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  FileText,
  Loader2,
  MapPin,
  Plus,
  Sparkles,
  Upload,
  Wind,
  X,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { isHVHZ, getCountyLabel } from "@/lib/county-utils";

const FLORIDA_COUNTIES = [
  "miami-dade",
  "broward",
  "palm-beach",
  "hillsborough",
  "orange",
  "duval",
  "pinellas",
  "lee",
  "brevard",
  "volusia",
  "sarasota",
  "manatee",
  "collier",
  "polk",
  "seminole",
  "pasco",
  "osceola",
  "st-lucie",
  "escambia",
  "marion",
  "alachua",
  "leon",
  "clay",
  "st-johns",
  "okaloosa",
  "hernando",
  "charlotte",
  "citrus",
  "indian-river",
  "martin",
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
  { id: 1, label: "Project", icon: Building2 },
  { id: 2, label: "Documents", icon: FileText },
  { id: 3, label: "Review", icon: Sparkles },
];

interface ExistingProject {
  id: string;
  name: string;
  address: string;
  county: string;
  jurisdiction: string;
  trade_type: string;
  services: string[];
}

interface NewPlanReviewWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: (reviewId: string) => void;
}

export function NewPlanReviewWizard({
  open,
  onOpenChange,
  onComplete,
}: NewPlanReviewWizardProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<"new" | "existing" | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // New project form
  const [projectName, setProjectName] = useState("");
  const [address, setAddress] = useState("");
  const [county, setCounty] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [tradeType, setTradeType] = useState("");
  const [services, setServices] = useState("");

  // Existing project selection
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedProject, setSelectedProject] = useState<ExistingProject | null>(null);

  // Upload state
  const [uploadedFiles, setUploadedFiles] = useState<{ name: string; url: string }[]>([]);

  // Created IDs
  const [createdProjectId, setCreatedProjectId] = useState("");
  const [createdReviewId, setCreatedReviewId] = useState("");

  const { data: existingProjects } = useQuery({
    queryKey: ["projects-for-wizard"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, address, county, jurisdiction, trade_type, services")
        .order("name");
      if (error) throw error;
      return data as ExistingProject[];
    },
    enabled: open,
  });

  const activeCounty = mode === "existing" ? selectedProject?.county || "" : county;
  const hvhz = isHVHZ(activeCounty);

  const resetState = () => {
    setStep(1);
    setMode(null);
    setProjectName("");
    setAddress("");
    setCounty("");
    setJurisdiction("");
    setTradeType("");
    setServices("");
    setSelectedProjectId("");
    setSelectedProject(null);
    setUploadedFiles([]);
    setCreatedProjectId("");
    setCreatedReviewId("");
  };

  const handleClose = () => {
    resetState();
    onOpenChange(false);
  };

  // Step 1 validation
  const step1Valid =
    mode === "existing"
      ? !!selectedProjectId
      : !!(projectName && address && county && tradeType && services);

  // Step 1 → Step 2: Create project + plan_review
  const handleStep1Next = async () => {
    setSaving(true);
    try {
      let projectId = selectedProjectId;

      if (mode === "new") {
        const serviceArray =
          services === "both"
            ? ["plan_review", "inspections"]
            : [services];

        const { data: proj, error: projErr } = await supabase
          .from("projects")
          .insert({
            name: projectName,
            address,
            county,
            jurisdiction,
            trade_type: tradeType,
            services: serviceArray,
            status: "plan_review",
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

      setCreatedProjectId(projectId);
      setCreatedReviewId(review.id);
      setStep(2);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create review");
    } finally {
      setSaving(false);
    }
  };

  // Step 2: File upload
  const handleFileUpload = async (files: FileList | null) => {
    if (!files || !createdReviewId) return;
    setUploading(true);
    try {
      const newFiles: { name: string; url: string }[] = [];
      for (const file of Array.from(files)) {
        if (file.type !== "application/pdf") {
          toast.error(`${file.name} is not a PDF`);
          continue;
        }
        if (file.size > 20 * 1024 * 1024) {
          toast.error(`${file.name} exceeds 20MB limit`);
          continue;
        }
        const path = `plan-reviews/${createdReviewId}/${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from("documents")
          .upload(path, file, { upsert: true });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from("documents").getPublicUrl(path);
        newFiles.push({ name: file.name, url: urlData.publicUrl });
      }

      const allUrls = [...uploadedFiles, ...newFiles].map((f) => f.url);
      await supabase
        .from("plan_reviews")
        .update({ file_urls: allUrls })
        .eq("id", createdReviewId);

      setUploadedFiles((prev) => [...prev, ...newFiles]);
      toast.success(`${newFiles.length} file(s) uploaded`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const removeFile = async (url: string) => {
    const remaining = uploadedFiles.filter((f) => f.url !== url);
    setUploadedFiles(remaining);
    await supabase
      .from("plan_reviews")
      .update({ file_urls: remaining.map((f) => f.url) })
      .eq("id", createdReviewId);
  };

  // Step 3: Launch
  const handleLaunch = () => {
    queryClient.invalidateQueries({ queryKey: ["plan-reviews"] });
    onComplete(createdReviewId);
    handleClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-[var(--font-display)] text-xl">
            New Plan Review
          </DialogTitle>
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
                  <div
                    className={cn(
                      "h-px w-8",
                      done ? "bg-accent" : "bg-border"
                    )}
                  />
                )}
                <div
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                    active && "bg-accent text-accent-foreground",
                    done && "bg-accent/15 text-accent",
                    !active && !done && "bg-muted text-muted-foreground"
                  )}
                >
                  {done ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <Icon className="h-3 w-3" />
                  )}
                  {s.label}
                </div>
              </div>
            );
          })}
        </div>

        {/* ===== STEP 1: Project ===== */}
        {step === 1 && (
          <div className="space-y-5">
            {/* Mode selector */}
            {!mode && (
              <div className="grid grid-cols-2 gap-3">
                <Card
                  className="cursor-pointer hover:bg-muted/50 transition-colors border-2 border-transparent hover:border-accent/30"
                  onClick={() => setMode("new")}
                >
                  <CardContent className="p-6 text-center">
                    <Plus className="h-8 w-8 mx-auto mb-2 text-accent" />
                    <p className="font-medium text-sm">New Project</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Enter project details from scratch
                    </p>
                  </CardContent>
                </Card>
                <Card
                  className="cursor-pointer hover:bg-muted/50 transition-colors border-2 border-transparent hover:border-accent/30"
                  onClick={() => setMode("existing")}
                >
                  <CardContent className="p-6 text-center">
                    <Building2 className="h-8 w-8 mx-auto mb-2 text-accent" />
                    <p className="font-medium text-sm">Existing Project</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Add a review round to an existing project
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* New project form */}
            {mode === "new" && (
              <div className="space-y-4">
                <button
                  onClick={() => setMode(null)}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  <ArrowLeft className="h-3 w-3" /> Back
                </button>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Project Name *</Label>
                    <Input
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      placeholder="e.g. Palm Gardens Residential"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Address *</Label>
                    <Input
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="e.g. 123 Main St, Miami, FL"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">County *</Label>
                    <Select value={county} onValueChange={setCounty}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select county" />
                      </SelectTrigger>
                      <SelectContent>
                        {FLORIDA_COUNTIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            <span className="flex items-center gap-2">
                              {getCountyLabel(c)}
                              {isHVHZ(c) && (
                                <Wind className="h-3 w-3 text-destructive" />
                              )}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Jurisdiction</Label>
                    <Input
                      value={jurisdiction}
                      onChange={(e) => setJurisdiction(e.target.value)}
                      placeholder="e.g. City of Miami"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Trade Type *</Label>
                    <Select value={tradeType} onValueChange={setTradeType}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select trade" />
                      </SelectTrigger>
                      <SelectContent>
                        {TRADE_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Services *</Label>
                    <Select value={services} onValueChange={setServices}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select services" />
                      </SelectTrigger>
                      <SelectContent>
                        {SERVICES.map((s) => (
                          <SelectItem key={s.value} value={s.value}>
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* HVHZ warning */}
                {hvhz && (
                  <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                    <Wind className="h-5 w-5 text-destructive shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-destructive">
                        HVHZ — High Velocity Hurricane Zone
                      </p>
                      <p className="text-xs text-destructive/80">
                        Enhanced requirements apply (TAS 201/202/203, Miami-Dade NOA, ASCE 7 ≥170 mph).
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Existing project selector */}
            {mode === "existing" && (
              <div className="space-y-4">
                <button
                  onClick={() => setMode(null)}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  <ArrowLeft className="h-3 w-3" /> Back
                </button>

                <div className="space-y-1.5">
                  <Label className="text-xs">Select Project *</Label>
                  <Select
                    value={selectedProjectId}
                    onValueChange={(id) => {
                      setSelectedProjectId(id);
                      const proj = existingProjects?.find((p) => p.id === id) || null;
                      setSelectedProject(proj);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a project" />
                    </SelectTrigger>
                    <SelectContent>
                      {(existingProjects || []).map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          <span className="flex items-center gap-2">
                            {p.name}
                            <span className="text-muted-foreground text-xs">
                              — {getCountyLabel(p.county)}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedProject && (
                  <Card className="border shadow-subtle">
                    <CardContent className="p-4 space-y-2">
                      <p className="text-sm font-medium">{selectedProject.name}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {selectedProject.address}
                      </p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="secondary" className="text-xs capitalize">
                          {selectedProject.trade_type}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {getCountyLabel(selectedProject.county)} County
                        </Badge>
                        {isHVHZ(selectedProject.county) && (
                          <Badge className="text-xs bg-destructive/10 text-destructive border-destructive/30" variant="outline">
                            <Wind className="h-3 w-3 mr-1" /> HVHZ
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* Next button */}
            {mode && (
              <Button
                onClick={handleStep1Next}
                disabled={!step1Valid || saving}
                className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
              >
                {saving ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating...</>
                ) : (
                  <>Next: Upload Plans <ArrowRight className="h-4 w-4 ml-2" /></>
                )}
              </Button>
            )}
          </div>
        )}

        {/* ===== STEP 2: Documents ===== */}
        {step === 2 && (
          <div className="space-y-5">
            <div className="text-center py-4">
              <Upload className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-sm font-medium">Upload Plan Documents</p>
              <p className="text-xs text-muted-foreground mt-1">
                Upload PDF plan sheets for AI analysis. You can also skip and add later.
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

            <Button
              variant="outline"
              className="w-full h-24 border-dashed border-2"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Uploading...</>
              ) : (
                <div className="text-center">
                  <Upload className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                  <span className="text-sm">Click to upload PDFs</span>
                  <span className="text-xs text-muted-foreground block mt-0.5">
                    Max 20MB per file
                  </span>
                </div>
              )}
            </Button>

            {/* Uploaded files list */}
            {uploadedFiles.length > 0 && (
              <div className="space-y-2">
                {uploadedFiles.map((f) => (
                  <div
                    key={f.url}
                    className="flex items-center justify-between rounded-md border px-3 py-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="h-4 w-4 text-accent shrink-0" />
                      <span className="text-sm truncate">{f.name}</span>
                    </div>
                    <button
                      onClick={() => removeFile(f.url)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setStep(3)}
                className="flex-1"
              >
                Skip for now
              </Button>
              <Button
                onClick={() => setStep(3)}
                disabled={uploadedFiles.length === 0}
                className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90"
              >
                Next: Review <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </div>
        )}

        {/* ===== STEP 3: Review & Launch ===== */}
        {step === 3 && (
          <div className="space-y-5">
            <Card className="border shadow-subtle">
              <CardContent className="p-4 space-y-3">
                <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                  Review Summary
                </p>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Project</span>
                    <span className="font-medium">
                      {mode === "existing"
                        ? selectedProject?.name
                        : projectName}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">County</span>
                    <span className="font-medium flex items-center gap-1">
                      {getCountyLabel(activeCounty)}
                      {hvhz && <Wind className="h-3 w-3 text-destructive" />}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Trade</span>
                    <span className="font-medium capitalize">
                      {mode === "existing"
                        ? selectedProject?.trade_type
                        : tradeType}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Documents</span>
                    <span className="font-medium">
                      {uploadedFiles.length > 0
                        ? `${uploadedFiles.length} PDF(s)`
                        : "None yet"}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {hvhz && (
              <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <Wind className="h-5 w-5 text-destructive shrink-0" />
                <p className="text-xs text-destructive/80">
                  HVHZ analysis will enforce Miami-Dade TAS testing, NOA product
                  approvals, and enhanced wind load requirements.
                </p>
              </div>
            )}

            <Button
              onClick={handleLaunch}
              className="w-full h-12 bg-accent text-accent-foreground hover:bg-accent/90"
            >
              <Sparkles className="h-4 w-4 mr-2" />
              Create Review & Open Workspace
            </Button>

            <button
              onClick={() => setStep(2)}
              className="w-full text-xs text-muted-foreground hover:text-foreground text-center"
            >
              <ArrowLeft className="h-3 w-3 inline mr-1" /> Back to documents
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
