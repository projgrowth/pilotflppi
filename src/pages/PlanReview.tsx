import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { FileSearch, ChevronRight, Wind, Plus, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { NewPlanReviewWizard } from "@/components/NewPlanReviewWizard";
import { DeadlineRing } from "@/components/DeadlineRing";
import { isHVHZ, getCountyLabel } from "@/lib/county-utils";
import { useState, useCallback } from "react";
import type { Finding } from "@/components/FindingCard";

interface PlanReviewRow {
  id: string;
  project_id: string;
  ai_check_status: string;
  ai_findings: unknown;
  file_urls: string[];
  round: number;
  created_at: string;
  project?: { id: string; name: string; address: string; trade_type: string; county: string; jurisdiction: string } | null;
}

function usePlanReviews() {
  return useQuery({
    queryKey: ["plan-reviews"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plan_reviews")
        .select("*, project:projects(id, name, address, trade_type, county, jurisdiction)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as PlanReviewRow[];
    },
  });
}

function hasCriticalFindings(review: PlanReviewRow): boolean {
  const findings = review.ai_findings as Finding[] | null;
  return Array.isArray(findings) && findings.some((f) => f.severity === "critical");
}

function getDaysRemaining(createdAt: string): number {
  const deadline = new Date(createdAt);
  deadline.setDate(deadline.getDate() + 21);
  const now = new Date();
  return Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
}

export default function PlanReview() {
  const { data: reviews, isLoading } = usePlanReviews();
  const navigate = useNavigate();
  const [wizardOpen, setWizardOpen] = useState(false);

  const handleWizardComplete = useCallback((reviewId: string) => {
    navigate(`/plan-review/${reviewId}`);
  }, [navigate]);

  const totalReviews = reviews?.length || 0;
  const completedReviews = reviews?.filter((r) => r.ai_check_status === "complete").length || 0;
  const totalFindings = reviews?.reduce((sum, r) => sum + (Array.isArray(r.ai_findings) ? (r.ai_findings as Finding[]).length : 0), 0) || 0;

  return (
    <div className="p-6 md:p-8 max-w-7xl">
      <PageHeader
        title="Plan Review"
        subtitle="AI-powered code compliance analysis"
        actions={
          <Button onClick={() => setWizardOpen(true)} className="bg-accent text-accent-foreground hover:bg-accent/90">
            <Plus className="h-4 w-4 mr-2" /> New Review
          </Button>
        }
      />

      <NewPlanReviewWizard open={wizardOpen} onOpenChange={setWizardOpen} onComplete={handleWizardComplete} />

      {totalReviews > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <Card className="shadow-subtle border">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-semibold text-foreground">{totalReviews}</p>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Total Reviews</p>
            </CardContent>
          </Card>
          <Card className="shadow-subtle border">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-semibold text-success">{completedReviews}</p>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Completed</p>
            </CardContent>
          </Card>
          <Card className="shadow-subtle border">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-semibold text-foreground">{totalFindings}</p>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Total Findings</p>
            </CardContent>
          </Card>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      ) : (reviews || []).length === 0 ? (
        <EmptyState
          icon={FileSearch}
          title="No reviews in queue"
          description="Upload plan documents to start your first AI-powered review"
          actionLabel="Start New Review"
          onAction={() => setWizardOpen(true)}
        />
      ) : (
        <Card className="shadow-subtle border">
          {/* Column headers */}
          <div className="hidden md:grid grid-cols-[1fr_100px_120px_60px_80px_100px_80px_24px] gap-4 px-5 py-2.5 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold border-b bg-muted/30">
            <span>Project</span>
            <span>Trade</span>
            <span>County</span>
            <span>Days</span>
            <span>Round</span>
            <span>Status</span>
            <span>Findings</span>
            <span />
          </div>
          <div className="divide-y">
            {(reviews || []).map((review) => {
              const findingsCount = Array.isArray(review.ai_findings) ? (review.ai_findings as Finding[]).length : 0;
              const critical = hasCriticalFindings(review);
              const hasFiles = review.file_urls && review.file_urls.length > 0;
              const daysLeft = getDaysRemaining(review.created_at);
              return (
                <div
                  key={review.id}
                  className={cn(
                    "list-row grid grid-cols-1 md:grid-cols-[1fr_100px_120px_60px_80px_100px_80px_24px] gap-2 md:gap-4 items-center px-5",
                    critical && "border-l-2 border-l-destructive"
                  )}
                  onClick={() => navigate(`/plan-review/${review.id}`)}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{review.project?.name || "Unnamed"}</p>
                      {hasFiles && <FileText className="h-3 w-3 text-accent shrink-0" />}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{review.project?.address}</p>
                  </div>
                  <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-medium capitalize w-fit">{review.project?.trade_type}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-medium">{getCountyLabel(review.project?.county || "")}</span>
                    {isHVHZ(review.project?.county || "") && <Wind className="h-3 w-3 text-destructive" />}
                  </div>
                  <div className="hidden md:flex items-center justify-center">
                    <DeadlineRing daysElapsed={21 - daysLeft} totalDays={21} size={28} />
                  </div>
                  <Badge variant="secondary" className="text-xs w-fit">R{review.round}</Badge>
                  <Badge
                    className={cn("text-[10px] w-fit", {
                      "bg-success/10 text-success border-success/20": review.ai_check_status === "complete",
                      "bg-accent/10 text-accent border-accent/20": review.ai_check_status === "running",
                      "bg-muted text-muted-foreground": review.ai_check_status === "pending",
                      "bg-destructive/10 text-destructive": review.ai_check_status === "error",
                    })}
                    variant="outline"
                  >
                    {review.ai_check_status}
                  </Badge>
                  <span className="text-xs text-muted-foreground font-medium">
                    {findingsCount > 0 ? `${findingsCount}` : "—"}
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/40 hidden md:block" />
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
