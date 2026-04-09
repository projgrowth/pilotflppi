import { useParams, useNavigate } from "react-router-dom";
import { useProject, getDaysElapsed, getDaysRemaining } from "@/hooks/useProjects";
import { useProjectActivityLog, getEventColor } from "@/hooks/useActivityLog";
import { usePlanReviewFilesByProject } from "@/hooks/usePlanReviewFiles";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient, useQuery } from "@tanstack/react-query";

/** Extract the relative storage path from a full Supabase URL or return as-is */
function getRelativeStoragePath(filePath: string): string {
  const markers = [
    "/storage/v1/object/public/documents/",
    "/storage/v1/object/documents/",
  ];
  for (const marker of markers) {
    const idx = filePath.indexOf(marker);
    if (idx !== -1) return decodeURIComponent(filePath.substring(idx + marker.length));
  }
  return filePath;
}
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/StatusChip";
import { DeadlineBar } from "@/components/DeadlineBar";
import { HorizontalStepper } from "@/components/HorizontalStepper";
import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { FileText, ClipboardCheck, Activity, Upload, Loader2, Download, Building2 } from "lucide-react";
import { ZoningAnalysisPanel } from "@/components/ZoningAnalysisPanel";
import { ZoningData } from "@/lib/zoning-utils";
import { StatutoryClockCard } from "@/components/StatutoryClockCard";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useRef, useState } from "react";

const timelineSteps = [
  { key: "intake", label: "Intake" },
  { key: "plan_review", label: "Plan Review" },
  { key: "comments_sent", label: "Comments" },
  { key: "resubmitted", label: "Resubmit" },
  { key: "approved", label: "Approved" },
  { key: "permit_issued", label: "Permit" },
  { key: "inspection_scheduled", label: "Inspection" },
  { key: "certificate_issued", label: "Certificate" },
];

const statusOrder: Record<string, number> = {};
timelineSteps.forEach((s, i) => { statusOrder[s.key] = i; });

function formatServiceName(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function useProjectDocuments(projectId: string) {
  return useQuery({
    queryKey: ["project-documents", projectId],
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from("documents")
        .list(`projects/${projectId}`, { limit: 50, sortBy: { column: "created_at", order: "desc" } });
      if (error) throw error;
      return (data || []).filter((f) => f.name !== ".emptyFolderPlaceholder");
    },
    enabled: !!projectId,
  });
}

function useProjectReviews(projectId: string) {
  return useQuery({
    queryKey: ["project-reviews", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plan_reviews")
        .select("id, round, ai_check_status, ai_findings, created_at")
        .eq("project_id", projectId)
        .order("round", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
  });
}

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: project, isLoading } = useProject(id || "");
  const { data: activity, isLoading: activityLoading } = useProjectActivityLog(id || "");
  const { data: documents } = useProjectDocuments(id || "");
  const { data: planReviewFiles } = usePlanReviewFilesByProject(id);
  const { data: reviews } = useProjectReviews(id || "");
  const [uploading, setUploading] = useState(false);
  const [docFilter, setDocFilter] = useState<string>("all");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const DOC_CATEGORIES = [
    { value: "all", label: "All" },
    { value: "plans", label: "Plans" },
    { value: "letters", label: "Letters" },
    { value: "checklists", label: "Checklists" },
    { value: "certificates", label: "Certificates" },
    { value: "plan-review", label: "Plan Review" },
    { value: "other", label: "Other" },
  ];

  function inferCategory(name: string, source: string): string {
    if (source === "plan-review") return "plan-review";
    const lower = name.toLowerCase();
    if (/\.(dwg|dxf)$/.test(lower) || /plan|drawing|sheet|floor|site|elevation|section|detail/i.test(lower)) return "plans";
    if (/letter|comment|correspondence|memo/i.test(lower)) return "letters";
    if (/checklist|inspection.*form|review.*form/i.test(lower)) return "checklists";
    if (/certificate|cert|co\b|cco|completion/i.test(lower)) return "certificates";
    return "other";
  }

  // Merge storage documents + plan review files into a unified list
  const allDocuments = (() => {
    const items: { key: string; name: string; date: string; source: string; storagePath?: string; category: string }[] = [];
    for (const doc of documents || []) {
      const cat = inferCategory(doc.name, "upload");
      items.push({ key: `storage-${doc.name}`, name: doc.name, date: doc.created_at, source: "upload", storagePath: `projects/${id}/${doc.name}`, category: cat });
    }
    for (const f of planReviewFiles || []) {
      const relativePath = getRelativeStoragePath(f.file_path);
      const fileName = relativePath.split("/").pop() || relativePath;
      items.push({ key: `prf-${f.id}`, name: `R${f.round} — ${decodeURIComponent(fileName)}`, date: f.uploaded_at, source: "plan-review", storagePath: relativePath, category: "plan-review" });
    }
    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return items;
  })();

  const handleDownloadDoc = async (storagePath: string, displayName: string) => {
    // Use signed URL since the documents bucket is private
    const { data: signedData, error: signError } = await supabase.storage
      .from("documents")
      .createSignedUrl(storagePath, 3600);
    if (signError || !signedData?.signedUrl) {
      toast.error(signError?.message || "Could not generate download link");
      return;
    }
    const a = document.createElement("a");
    a.href = signedData.signedUrl;
    a.download = displayName;
    a.target = "_blank";
    a.click();
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || !id) return;
    setUploading(true);
    let count = 0;
    for (const file of Array.from(files)) {
      const path = `projects/${id}/${file.name}`;
      const { error } = await supabase.storage.from("documents").upload(path, file, { upsert: true });
      if (error) toast.error(`${file.name}: ${error.message}`);
      else count++;
    }
    if (count > 0) {
      toast.success(`${count} file(s) uploaded`);
      queryClient.invalidateQueries({ queryKey: ["project-documents", id] });
    }
    setUploading(false);
  };

  if (isLoading) {
    return (
      <div className="p-6 md:p-8 max-w-6xl space-y-6">
        <div className="h-6 w-32 rounded bg-muted animate-pulse" />
        <div className="h-16 rounded bg-muted animate-pulse" />
        <div className="grid gap-6 md:grid-cols-2">
          <div className="h-48 rounded bg-muted animate-pulse" />
          <div className="h-48 rounded bg-muted animate-pulse" />
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <h2 className="text-lg font-medium mb-2">Project not found</h2>
        <Button variant="outline" onClick={() => navigate("/projects")}>Back to Projects</Button>
      </div>
    );
  }

  const daysElapsed = getDaysElapsed(project.notice_filed_at);
  const currentStepIndex = statusOrder[project.status] ?? 0;
  const findingsCount = (reviews || []).reduce((sum, r) => sum + (Array.isArray(r.ai_findings) ? (r.ai_findings as unknown[]).length : 0), 0);

  // Build detail rows, filtering out empty values
  const detailRows = [
    project.county && ["County", project.county],
    project.jurisdiction && ["Jurisdiction", project.jurisdiction],
    ["Trade", formatServiceName(project.trade_type)],
    project.contractor?.name && ["Contractor", project.contractor.name],
    project.notice_filed_at && ["Notice Filed", format(new Date(project.notice_filed_at), "MMM d, yyyy")],
    project.deadline_at && ["Deadline", format(new Date(project.deadline_at), "MMM d, yyyy")],
    (project.services || []).length > 0 && ["Services", project.services.map(formatServiceName).join(", ")],
  ].filter(Boolean) as [string, string][];

  return (
    <div className="p-6 md:p-8 max-w-6xl">
      {/* Header with breadcrumbs + inline actions */}
      <PageHeader
        title={project.name}
        subtitle={project.address}
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Projects", href: "/projects" },
          { label: project.name },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="text-xs" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-3.5 w-3.5 mr-1" /> Upload
            </Button>
            {reviews && reviews.length > 0 ? (
              <Button
                size="sm"
                className="text-xs bg-accent text-accent-foreground hover:bg-accent/90"
                onClick={() => navigate(`/plan-review/${reviews[0].id}`)}
              >
                <ClipboardCheck className="h-3.5 w-3.5 mr-1" /> Review
              </Button>
            ) : (
              <Button
                size="sm"
                className="text-xs bg-accent text-accent-foreground hover:bg-accent/90"
                onClick={() => navigate("/plan-review")}
              >
                <ClipboardCheck className="h-3.5 w-3.5 mr-1" /> Review
              </Button>
            )}
            <StatusChip status={project.status} />
          </div>
        }
      />

      {/* Horizontal stepper — full width */}
      <Card className="shadow-subtle border mb-6">
        <CardContent className="px-6 py-5">
          <HorizontalStepper steps={timelineSteps} currentStepIndex={currentStepIndex} />
        </CardContent>
      </Card>

      {/* Two-column: details + tabs */}
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Left: Status & Details combined */}
        <div className="space-y-4">
          {/* Deadline bar */}
          <Card className="shadow-subtle border">
            <CardContent className="p-5">
              <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Deadline</h3>
              <DeadlineBar daysElapsed={daysElapsed} />
            </CardContent>
          </Card>

          {/* Statutory Clock (F.S. 553.791) */}
          <StatutoryClockCard project={project} />

          {/* Details */}
          <Card className="shadow-subtle border">
            <CardContent className="p-5">
              <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Details</h3>
              <div className="space-y-0">
                {detailRows.map(([label, value]) => (
                  <div key={label} className="flex justify-between text-sm py-2 border-b border-border/50 last:border-0 hover:bg-muted/30 -mx-2 px-2 rounded transition-colors">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium text-right">{value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: Tabs */}
        <div>
          <Tabs defaultValue="activity">
            <TabsList>
              <TabsTrigger value="activity" className="gap-1.5"><Activity className="h-3.5 w-3.5" />Activity</TabsTrigger>
              <TabsTrigger value="documents" className="gap-1.5">
                <FileText className="h-3.5 w-3.5" />Documents
                {allDocuments.length > 0 && (
                  <span className="ml-1 text-[10px] bg-accent/15 text-accent rounded-full px-1.5 py-0.5 font-semibold">{allDocuments.length}</span>
                )}
              </TabsTrigger>
              <TabsTrigger value="zoning" className="gap-1.5">
                <Building2 className="h-3.5 w-3.5" />Zoning
              </TabsTrigger>
              <TabsTrigger value="plan-review" className="gap-1.5">
                <ClipboardCheck className="h-3.5 w-3.5" />Plan Review
                {findingsCount > 0 && (
                  <span className="ml-1 text-[10px] bg-accent/15 text-accent rounded-full px-1.5 py-0.5 font-semibold">{findingsCount}</span>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="activity">
              <Card className="shadow-subtle border">
                <CardContent className="p-0 divide-y">
                  {activityLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="flex gap-3 px-5 py-3">
                        <div className="h-2 w-2 rounded-full bg-muted animate-pulse mt-1.5" />
                        <div className="flex-1 space-y-1">
                          <div className="h-4 w-full rounded bg-muted animate-pulse" />
                          <div className="h-3 w-20 rounded bg-muted animate-pulse" />
                        </div>
                      </div>
                    ))
                  ) : (activity || []).length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">No activity recorded</div>
                  ) : (
                    (activity || []).map((item) => (
                      <div key={item.id} className="flex items-start gap-3 px-5 py-3">
                        <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${getEventColor(item.event_type)}`} />
                        <div className="flex-1">
                          <p className="text-sm">{item.description}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="documents">
              <Card className="shadow-subtle border">
                <CardContent className="p-4 space-y-3">
                  <div
                    className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:bg-muted/20 transition-colors"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploading ? (
                      <Loader2 className="h-6 w-6 mx-auto text-accent animate-spin mb-1" />
                    ) : (
                      <Upload className="h-6 w-6 mx-auto text-muted-foreground/40 mb-1" />
                    )}
                    <p className="text-xs text-muted-foreground">{uploading ? "Uploading..." : "Drop files or click to upload"}</p>
                    <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => handleUpload(e.target.files)} />
                  </div>

                  {/* Category filter chips */}
                  {allDocuments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {DOC_CATEGORIES.map((cat) => {
                        const count = cat.value === "all" ? allDocuments.length : allDocuments.filter((d) => d.category === cat.value).length;
                        if (count === 0 && cat.value !== "all") return null;
                        return (
                          <button
                            key={cat.value}
                            onClick={() => setDocFilter(cat.value)}
                            className={cn(
                              "px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors border",
                              docFilter === cat.value
                                ? "bg-accent text-accent-foreground border-accent"
                                : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/50"
                            )}
                          >
                            {cat.label} {count > 0 && <span className="ml-0.5 opacity-70">{count}</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {allDocuments.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">No documents uploaded yet</p>
                  ) : (
                    <div className="divide-y">
                      {allDocuments
                        .filter((doc) => docFilter === "all" || doc.category === docFilter)
                        .map((doc) => (
                        <div key={doc.key} className="flex items-center gap-3 py-2">
                          <FileText className="h-4 w-4 text-accent shrink-0" />
                          <span className="text-sm truncate flex-1">{doc.name}</span>
                          <Badge variant="secondary" className="text-[9px] shrink-0 capitalize">{doc.category}</Badge>
                          <span className="text-[10px] text-muted-foreground shrink-0">{format(new Date(doc.date), "MMM d")}</span>
                          {doc.storagePath && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => handleDownloadDoc(doc.storagePath!, doc.name)}>
                              <Download className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="zoning">
              <ZoningAnalysisPanel
                projectId={project.id}
                initialData={(project.zoning_data as unknown as ZoningData) ?? null}
                onSaved={() => queryClient.invalidateQueries({ queryKey: ["project", id] })}
              />
            </TabsContent>

            <TabsContent value="plan-review">
              <Card className="shadow-subtle border">
                <CardContent className="p-4">
                  {(reviews || []).length === 0 ? (
                    <div className="text-center py-8">
                      <ClipboardCheck className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
                      <p className="text-sm text-muted-foreground">No plan reviews yet</p>
                      <Button
                        className="mt-3 bg-accent text-accent-foreground hover:bg-accent/90"
                        size="sm"
                        onClick={() => navigate("/plan-review")}
                      >
                        Go to Plan Review
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {(reviews || []).map((r) => {
                        const count = Array.isArray(r.ai_findings) ? (r.ai_findings as unknown[]).length : 0;
                        return (
                          <div
                            key={r.id}
                            className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/30 cursor-pointer transition-colors"
                            onClick={() => navigate(`/plan-review/${r.id}`)}
                          >
                            <div className="flex items-center gap-3">
                              <Badge variant="secondary" className="text-xs">R{r.round}</Badge>
                              <span className="text-sm font-medium">{format(new Date(r.created_at), "MMM d, yyyy")}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className={cn("text-[10px]",
                                r.ai_check_status === "complete" ? "text-success border-success/30" :
                                r.ai_check_status === "running" ? "text-accent border-accent/30" :
                                "text-muted-foreground"
                              )}>
                                {r.ai_check_status}
                              </Badge>
                              {count > 0 && <span className="text-xs text-muted-foreground">{count} findings</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
