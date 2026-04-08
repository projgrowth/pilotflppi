import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { callAI, streamAI } from "@/lib/ai";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { StatusChip } from "@/components/StatusChip";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FileSearch, Sparkles, Send, Loader2, AlertTriangle, AlertCircle, Info, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface PlanReviewRow {
  id: string;
  project_id: string;
  ai_check_status: string;
  ai_findings: unknown;
  round: number;
  created_at: string;
  project?: { id: string; name: string; address: string; trade_type: string } | null;
}

interface Finding {
  severity: string;
  code_ref: string;
  page: string;
  description: string;
  recommendation: string;
}

function usePlanReviews() {
  return useQuery({
    queryKey: ["plan-reviews"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plan_reviews")
        .select("*, project:projects(id, name, address, trade_type)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as PlanReviewRow[];
    },
  });
}

const severityIcon: Record<string, typeof AlertTriangle> = {
  critical: AlertTriangle,
  major: AlertCircle,
  minor: Info,
};

const severityColor: Record<string, string> = {
  critical: "bg-destructive/10 text-destructive",
  major: "bg-warning/10 text-warning",
  minor: "bg-muted text-muted-foreground",
};

export default function PlanReview() {
  const { data: reviews, isLoading } = usePlanReviews();
  const queryClient = useQueryClient();
  const [selectedReview, setSelectedReview] = useState<PlanReviewRow | null>(null);
  const [aiRunning, setAiRunning] = useState(false);
  const [commentLetter, setCommentLetter] = useState("");
  const [generatingLetter, setGeneratingLetter] = useState(false);

  const runAICheck = async (review: PlanReviewRow) => {
    setAiRunning(true);
    try {
      await supabase.from("plan_reviews").update({ ai_check_status: "running" }).eq("id", review.id);
      queryClient.invalidateQueries({ queryKey: ["plan-reviews"] });

      const result = await callAI({
        action: "plan_review_check",
        payload: {
          project_name: review.project?.name,
          address: review.project?.address,
          trade_type: review.project?.trade_type,
          round: review.round,
        },
      });

      let findings: Finding[] = [];
      try {
        const match = result.match(/\[[\s\S]*\]/);
        if (match) findings = JSON.parse(match[0]);
      } catch { findings = []; }

      await supabase.from("plan_reviews").update({
        ai_check_status: "complete",
        ai_findings: JSON.parse(JSON.stringify(findings)),
      }).eq("id", review.id);

      queryClient.invalidateQueries({ queryKey: ["plan-reviews"] });
      setSelectedReview({ ...review, ai_check_status: "complete", ai_findings: findings });
      toast.success(`AI check complete — ${findings.length} findings`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI check failed");
      await supabase.from("plan_reviews").update({ ai_check_status: "error" }).eq("id", review.id);
      queryClient.invalidateQueries({ queryKey: ["plan-reviews"] });
    } finally {
      setAiRunning(false);
    }
  };

  const generateCommentLetter = async (review: PlanReviewRow) => {
    setGeneratingLetter(true);
    setCommentLetter("");
    try {
      await streamAI({
        action: "generate_comment_letter",
        payload: {
          project_name: review.project?.name,
          address: review.project?.address,
          trade_type: review.project?.trade_type,
          findings: review.ai_findings,
          round: review.round,
        },
        onDelta: (chunk) => setCommentLetter((prev) => prev + chunk),
        onDone: () => setGeneratingLetter(false),
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate letter");
      setGeneratingLetter(false);
    }
  };

  const findings = (selectedReview?.ai_findings as Finding[]) || [];

  return (
    <div className="p-6 md:p-8 max-w-7xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-medium">Plan Review</h1>
      </div>

      {/* Queue list */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : (reviews || []).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FileSearch className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <h2 className="text-lg font-medium">No reviews in queue</h2>
          <p className="text-sm text-muted-foreground mt-1">Plan reviews will appear here when projects enter the review stage</p>
        </div>
      ) : (
        <div className="space-y-2">
          {(reviews || []).map((review) => {
            const findingsCount = Array.isArray(review.ai_findings) ? (review.ai_findings as Finding[]).length : 0;
            return (
              <Card
                key={review.id}
                className="shadow-subtle border cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => { setSelectedReview(review); setCommentLetter(""); }}
              >
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{review.project?.name || "Unnamed"}</p>
                    <p className="text-xs text-muted-foreground truncate">{review.project?.address}</p>
                  </div>
                  <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-medium capitalize">{review.project?.trade_type}</span>
                  <Badge variant="secondary" className="text-xs">Round {review.round}</Badge>
                  <StatusChip status={review.ai_check_status === "complete" ? "approved" : review.ai_check_status === "running" ? "in_review" : "pending"} />
                  {findingsCount > 0 && (
                    <span className="text-xs text-muted-foreground">{findingsCount} findings</span>
                  )}
                  <ChevronRight className="h-4 w-4 text-muted-foreground/40" />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Review detail panel */}
      <Sheet open={!!selectedReview} onOpenChange={(open) => !open && setSelectedReview(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{selectedReview?.project?.name || "Plan Review"}</SheetTitle>
          </SheetHeader>

          {selectedReview && (
            <div className="mt-6 space-y-6">
              {/* Project info */}
              <Card className="shadow-subtle border">
                <CardContent className="p-4 space-y-1">
                  <p className="text-sm">{selectedReview.project?.address}</p>
                  <div className="flex gap-2">
                    <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-medium capitalize">{selectedReview.project?.trade_type}</span>
                    <Badge variant="secondary" className="text-xs">Round {selectedReview.round}</Badge>
                  </div>
                </CardContent>
              </Card>

              {/* AI Check button */}
              <Button
                onClick={() => runAICheck(selectedReview)}
                disabled={aiRunning}
                className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
              >
                {aiRunning ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Running AI Pre-Check...</>
                ) : (
                  <><Sparkles className="h-4 w-4 mr-2" /> Run AI Pre-Check</>
                )}
              </Button>

              {/* Scanning animation */}
              {aiRunning && (
                <div className="space-y-2">
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full w-1/3 rounded-full bg-accent animate-pulse" style={{ animation: "pulse 1s ease-in-out infinite, moveRight 2s ease-in-out infinite" }} />
                  </div>
                  <p className="text-xs text-muted-foreground text-center">Analyzing plans against Florida Building Code...</p>
                </div>
              )}

              {/* Findings */}
              {findings.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                    Findings ({findings.length})
                  </h3>
                  <div className="space-y-2">
                    {findings.map((finding, i) => {
                      const Icon = severityIcon[finding.severity] || Info;
                      return (
                        <Card key={i} className="shadow-subtle border">
                          <CardContent className="p-4">
                            <div className="flex items-start gap-3">
                              <div className={cn("rounded p-1", severityColor[finding.severity] || "bg-muted")}>
                                <Icon className="h-3.5 w-3.5" />
                              </div>
                              <div className="flex-1 space-y-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <Badge className={cn("text-[10px]", severityColor[finding.severity])}>{finding.severity}</Badge>
                                  <span className="text-[11px] font-mono text-muted-foreground">{finding.code_ref}</span>
                                  {finding.page && <span className="text-[10px] text-muted-foreground">Page: {finding.page}</span>}
                                </div>
                                <p className="text-sm">{finding.description}</p>
                                <p className="text-xs text-muted-foreground"><strong>Recommendation:</strong> {finding.recommendation}</p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Comment Letter */}
              {findings.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Comment Letter</h3>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => generateCommentLetter(selectedReview)}
                      disabled={generatingLetter}
                    >
                      {generatingLetter ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
                      Generate Letter
                    </Button>
                  </div>
                  {(commentLetter || generatingLetter) && (
                    <Textarea
                      value={commentLetter}
                      onChange={(e) => setCommentLetter(e.target.value)}
                      rows={12}
                      className="font-mono text-xs"
                      placeholder={generatingLetter ? "Generating..." : ""}
                    />
                  )}
                  {commentLetter && !generatingLetter && (
                    <Button size="sm" className="mt-2 bg-accent text-accent-foreground hover:bg-accent/90">
                      <Send className="h-3.5 w-3.5 mr-1" /> Send to Contractor
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
