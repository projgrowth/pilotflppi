import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldCheck, ChevronRight, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useNavigate } from "react-router-dom";

interface PendingReview {
  id: string;
  round: number;
  created_at: string;
  ai_findings: any;
  project: { id: string; name: string; address: string } | null;
}

export function QcPendingWidget() {
  const navigate = useNavigate();

  const { data: pendingReviews, isLoading } = useQuery({
    queryKey: ["qc-pending-reviews"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plan_reviews")
        .select("id, round, created_at, ai_findings, project_id")
        .eq("qc_status", "pending_qc")
        .eq("ai_check_status", "complete")
        .order("created_at", { ascending: true })
        .limit(5);
      if (error) throw error;

      // Fetch project names
      const projectIds = [...new Set((data || []).map((r) => r.project_id))];
      if (projectIds.length === 0) return [];

      const { data: projects } = await supabase
        .from("projects")
        .select("id, name, address")
        .in("id", projectIds);

      const projectMap = new Map((projects || []).map((p) => [p.id, p]));

      return (data || []).map((r) => ({
        ...r,
        project: projectMap.get(r.project_id) || null,
      })) as PendingReview[];
    },
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <Card className="shadow-subtle">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="h-4 w-4 rounded bg-muted animate-pulse" />
            <div className="h-3 w-32 rounded bg-muted animate-pulse" />
          </div>
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-2">
              <div className="h-4 w-full rounded bg-muted animate-pulse" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  const count = pendingReviews?.length ?? 0;

  return (
    <Card className="shadow-subtle">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-warning" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
              QC Pending
            </span>
            {count > 0 && (
              <Badge variant="destructive" className="text-2xs px-1.5 py-0 h-4">
                {count}
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-accent"
            onClick={() => navigate("/plan-review")}
          >
            View all →
          </Button>
        </div>

        {count === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-3">
            All reviews approved ✓
          </p>
        ) : (
          <div className="space-y-1">
            {pendingReviews!.map((review) => {
              const findingCount = Array.isArray(review.ai_findings)
                ? review.ai_findings.length
                : 0;

              return (
                <div
                  key={review.id}
                  onClick={() => navigate(`/plan-review/${review.id}`)}
                  className="flex items-center gap-3 px-2 py-2 -mx-2 rounded-md cursor-pointer hover:bg-muted/50 transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {review.project?.name ?? "Unknown project"}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-2xs text-muted-foreground">
                        R{review.round}
                      </span>
                      <span className="text-2xs text-muted-foreground">•</span>
                      <span className="text-2xs text-muted-foreground">
                        {findingCount} finding{findingCount !== 1 ? "s" : ""}
                      </span>
                      <span className="text-2xs text-muted-foreground">•</span>
                      <span className="text-2xs text-muted-foreground flex items-center gap-0.5">
                        <Clock className="h-2.5 w-2.5" />
                        {formatDistanceToNow(new Date(review.created_at), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0 group-hover:text-foreground transition-colors" />
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
