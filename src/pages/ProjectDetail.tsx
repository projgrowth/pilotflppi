import { useParams, useNavigate } from "react-router-dom";
import { useProject, getDaysElapsed, getDaysRemaining } from "@/hooks/useProjects";
import { useProjectActivityLog, getEventColor } from "@/hooks/useActivityLog";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/StatusChip";
import { DeadlineRing } from "@/components/DeadlineRing";
import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { FileText, ClipboardCheck, Activity, Upload, Loader2 } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useRef, useState } from "react";

const timelineSteps = [
  { key: "intake", label: "Intake" },
  { key: "plan_review", label: "Plan Review" },
  { key: "comments_sent", label: "Comments Sent" },
  { key: "resubmitted", label: "Resubmitted" },
  { key: "approved", label: "Approved" },
  { key: "permit_issued", label: "Permit Issued" },
  { key: "inspection_scheduled", label: "Inspection" },
  { key: "certificate_issued", label: "Certificate" },
];

const statusOrder: Record<string, number> = {};
timelineSteps.forEach((s, i) => { statusOrder[s.key] = i; });

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
  const { data: reviews } = useProjectReviews(id || "");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      <div className="p-6 md:p-8 max-w-7xl space-y-6">
        <div className="h-6 w-32 rounded bg-muted animate-pulse" />
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3 space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 rounded bg-muted animate-pulse" />
            ))}
          </div>
          <div className="lg:col-span-2">
            <div className="h-64 rounded bg-muted animate-pulse" />
          </div>
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
  const daysRemaining = getDaysRemaining(project.deadline_at);
  const currentStepIndex = statusOrder[project.status] ?? 0;
  const findingsCount = (reviews || []).reduce((sum, r) => sum + (Array.isArray(r.ai_findings) ? (r.ai_findings as unknown[]).length : 0), 0);

  return (
    <div className="p-6 md:p-8 max-w-7xl">
      {/* Header with breadcrumbs */}
      <PageHeader
        title={project.name}
        subtitle={project.address}
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Projects", href: "/projects" },
          { label: project.name },
        ]}
        actions={<StatusChip status={project.status} className="text-sm px-3 py-1" />}
      />

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Left panel */}
        <div className="lg:col-span-3 space-y-6">
          {/* Timeline */}
          <Card className="shadow-subtle border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Project Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative ml-4">
                {timelineSteps.map((step, i) => {
                  const isComplete = i < currentStepIndex;
                  const isCurrent = i === currentStepIndex;
                  const isFuture = i > currentStepIndex;
                  return (
                    <div key={step.key} className="flex items-start gap-4 pb-6 last:pb-0 relative">
                      {i < timelineSteps.length - 1 && (
                        <div className={cn(
                          "absolute left-[7px] top-5 w-0.5 h-full",
                          isComplete ? "bg-success" : isCurrent ? "bg-accent" : "bg-border border-dashed"
                        )} />
                      )}
                      <div className={cn(
                        "relative z-10 h-4 w-4 rounded-full border-2 shrink-0 mt-0.5",
                        isComplete ? "bg-success border-success" : isCurrent ? "bg-background border-accent ring-2 ring-accent/30" : "bg-background border-border"
                      )} />
                      <div>
                        <p className={cn(
                          "text-sm font-medium",
                          isFuture ? "text-muted-foreground" : "text-foreground"
                        )}>{step.label}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Tabs */}
          <Tabs defaultValue="activity">
            <TabsList>
              <TabsTrigger value="documents" className="gap-1.5">
                <FileText className="h-3.5 w-3.5" />Documents
                {(documents || []).length > 0 && (
                  <span className="ml-1 text-[10px] bg-accent/15 text-accent rounded-full px-1.5 py-0.5 font-semibold">{(documents || []).length}</span>
                )}
              </TabsTrigger>
              <TabsTrigger value="plan-review" className="gap-1.5">
                <ClipboardCheck className="h-3.5 w-3.5" />Plan Review
                {findingsCount > 0 && (
                  <span className="ml-1 text-[10px] bg-accent/15 text-accent rounded-full px-1.5 py-0.5 font-semibold">{findingsCount}</span>
                )}
              </TabsTrigger>
              <TabsTrigger value="activity" className="gap-1.5"><Activity className="h-3.5 w-3.5" />Activity</TabsTrigger>
            </TabsList>

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
                  {(documents || []).length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">No documents uploaded yet</p>
                  ) : (
                    <div className="divide-y">
                      {(documents || []).map((doc) => (
                        <div key={doc.name} className="flex items-center gap-3 py-2">
                          <FileText className="h-4 w-4 text-accent shrink-0" />
                          <span className="text-sm truncate flex-1">{doc.name}</span>
                          <span className="text-[10px] text-muted-foreground">{format(new Date(doc.created_at), "MMM d")}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
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
                            onClick={() => navigate("/plan-review")}
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
          </Tabs>
        </div>

        {/* Right sidebar */}
        <div className="lg:col-span-2 space-y-4">
          {/* Deadline ring */}
          <Card className="shadow-subtle border">
            <CardContent className="p-5 flex flex-col items-center">
              <DeadlineRing daysElapsed={daysElapsed} size={120} />
              <p className={cn(
                "mt-3 font-mono text-sm font-medium",
                daysRemaining <= 0 ? "text-destructive" : daysRemaining <= 3 ? "text-destructive" : daysRemaining <= 6 ? "text-warning" : "text-success"
              )}>
                {daysRemaining <= 0 ? "OVERDUE" : `${daysRemaining} days remaining`}
              </p>
              <p className="text-xs text-muted-foreground">21-Day Statutory Clock</p>
            </CardContent>
          </Card>

          {/* Metadata */}
          <Card className="shadow-subtle border">
            <CardContent className="p-5 space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Details</h3>
              {[
                ["County", project.county || "—"],
                ["Jurisdiction", project.jurisdiction || "—"],
                ["Trade", project.trade_type],
                ["Contractor", project.contractor?.name || "—"],
                ["Notice Filed", project.notice_filed_at ? format(new Date(project.notice_filed_at), "MMM d, yyyy") : "—"],
                ["Deadline", project.deadline_at ? format(new Date(project.deadline_at), "MMM d, yyyy") : "—"],
                ["Services", (project.services || []).join(", ") || "—"],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium text-right capitalize">{value}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Quick actions */}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="sm" className="text-xs" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-3.5 w-3.5 mr-1" /> Upload Docs
            </Button>
            <Button
              size="sm"
              className="text-xs bg-accent text-accent-foreground hover:bg-accent/90"
              onClick={() => navigate("/plan-review")}
            >
              <ClipboardCheck className="h-3.5 w-3.5 mr-1" /> Plan Review
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}