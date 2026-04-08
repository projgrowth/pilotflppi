import { useParams, useNavigate } from "react-router-dom";
import { useProject, getDaysElapsed, getDaysRemaining } from "@/hooks/useProjects";
import { useProjectActivityLog, getEventColor } from "@/hooks/useActivityLog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/StatusChip";
import { DeadlineRing } from "@/components/DeadlineRing";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, FileText, ClipboardCheck, Activity, StickyNote, Sparkles } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

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

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: project, isLoading } = useProject(id || "");
  const { data: activity, isLoading: activityLoading } = useProjectActivityLog(id || "");

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

  return (
    <div className="p-6 md:p-8 max-w-7xl">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/projects")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-medium">{project.name}</h1>
          <p className="text-sm text-muted-foreground">{project.address}</p>
        </div>
        <StatusChip status={project.status} className="text-sm px-3 py-1" />
      </div>

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
              <TabsTrigger value="documents" className="gap-1.5"><FileText className="h-3.5 w-3.5" />Documents</TabsTrigger>
              <TabsTrigger value="plan-review" className="gap-1.5"><ClipboardCheck className="h-3.5 w-3.5" />Plan Review</TabsTrigger>
              <TabsTrigger value="activity" className="gap-1.5"><Activity className="h-3.5 w-3.5" />Activity</TabsTrigger>
              <TabsTrigger value="notes" className="gap-1.5"><StickyNote className="h-3.5 w-3.5" />Notes</TabsTrigger>
            </TabsList>

            <TabsContent value="documents">
              <Card className="shadow-subtle border">
                <CardContent className="py-12 text-center text-sm text-muted-foreground">
                  No documents uploaded yet
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="plan-review">
              <Card className="shadow-subtle border">
                <CardContent className="py-12 text-center">
                  <Sparkles className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
                  <p className="text-sm text-muted-foreground">AI plan review will appear here</p>
                  <Button className="mt-3 bg-accent text-accent-foreground hover:bg-accent/90" size="sm">
                    Run AI Pre-Check
                  </Button>
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

            <TabsContent value="notes">
              <Card className="shadow-subtle border">
                <CardContent className="py-12 text-center text-sm text-muted-foreground">
                  No notes yet
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
                ["County", project.county],
                ["Jurisdiction", project.jurisdiction],
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
            <Button variant="outline" size="sm" className="text-xs">Upload Docs</Button>
            <Button size="sm" className="text-xs bg-accent text-accent-foreground hover:bg-accent/90">Run AI Check</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
