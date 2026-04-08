import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { callAI, streamAI } from "@/lib/ai";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  FileSearch, Sparkles, Send, Loader2, ChevronRight, Copy, Check,
  AlertTriangle, Wind
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { FindingCard, type Finding } from "@/components/FindingCard";
import {
  isHVHZ, getCountyLabel, getDisciplineIcon, getDisciplineColor,
  getDisciplineLabel, DISCIPLINE_ORDER, SCANNING_STEPS, type Discipline,
} from "@/lib/county-utils";

interface PlanReviewRow {
  id: string;
  project_id: string;
  ai_check_status: string;
  ai_findings: unknown;
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

function groupFindingsByDiscipline(findings: Finding[]): Record<string, Finding[]> {
  const groups: Record<string, Finding[]> = {};
  for (const f of findings) {
    const d = f.discipline || "structural";
    if (!groups[d]) groups[d] = [];
    groups[d].push(f);
  }
  return groups;
}

function getWorstSeverity(findings: Finding[]): string {
  if (findings.some((f) => f.severity === "critical")) return "critical";
  if (findings.some((f) => f.severity === "major")) return "major";
  return "minor";
}

function hasCriticalFindings(review: PlanReviewRow): boolean {
  const findings = review.ai_findings as Finding[] | null;
  return Array.isArray(findings) && findings.some((f) => f.severity === "critical");
}

const severityColors: Record<string, string> = {
  critical: "bg-destructive text-destructive-foreground",
  major: "bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))]",
  minor: "bg-muted text-muted-foreground",
};

export default function PlanReview() {
  const { data: reviews, isLoading } = usePlanReviews();
  const queryClient = useQueryClient();
  const [selectedReview, setSelectedReview] = useState<PlanReviewRow | null>(null);
  const [aiRunning, setAiRunning] = useState(false);
  const [scanStep, setScanStep] = useState(0);
  const [commentLetter, setCommentLetter] = useState("");
  const [generatingLetter, setGeneratingLetter] = useState(false);
  const [copied, setCopied] = useState(false);

  // Scanning step animation
  useEffect(() => {
    if (!aiRunning) { setScanStep(0); return; }
    const interval = setInterval(() => {
      setScanStep((s) => (s + 1) % SCANNING_STEPS.length);
    }, 1800);
    return () => clearInterval(interval);
  }, [aiRunning]);

  const totalReviews = reviews?.length || 0;
  const completedReviews = reviews?.filter((r) => r.ai_check_status === "complete").length || 0;
  const totalFindings = reviews?.reduce((sum, r) => sum + (Array.isArray(r.ai_findings) ? (r.ai_findings as Finding[]).length : 0), 0) || 0;

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
          county: review.project?.county,
          jurisdiction: review.project?.jurisdiction,
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
          county: review.project?.county,
          jurisdiction: review.project?.jurisdiction,
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

  const copyLetter = () => {
    navigator.clipboard.writeText(commentLetter);
    setCopied(true);
    toast.success("Letter copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const findings = (selectedReview?.ai_findings as Finding[]) || [];
  const groupedFindings = groupFindingsByDiscipline(findings);
  const county = selectedReview?.project?.county || "";
  const hvhz = isHVHZ(county);

  const criticalCount = findings.filter((f) => f.severity === "critical").length;
  const majorCount = findings.filter((f) => f.severity === "major").length;
  const minorCount = findings.filter((f) => f.severity === "minor").length;

  return (
    <div className="p-6 md:p-8 max-w-7xl">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-medium font-[var(--font-display)]">Plan Review</h1>
        <p className="text-sm text-muted-foreground mt-1">AI-powered code compliance analysis by county & jurisdiction</p>
      </div>

      {/* Summary bar */}
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
              <p className="text-2xl font-semibold text-[hsl(var(--success))]">{completedReviews}</p>
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

      {/* Queue table header */}
      {!isLoading && (reviews || []).length > 0 && (
        <div className="hidden md:grid grid-cols-[1fr_100px_120px_80px_100px_80px_24px] gap-4 px-4 mb-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Project</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Trade</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">County</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Round</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Status</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Findings</span>
          <span />
        </div>
      )}

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
        <div className="space-y-1.5">
          {(reviews || []).map((review) => {
            const findingsCount = Array.isArray(review.ai_findings) ? (review.ai_findings as Finding[]).length : 0;
            const critical = hasCriticalFindings(review);
            return (
              <Card
                key={review.id}
                className={cn(
                  "shadow-subtle border cursor-pointer hover:bg-muted/30 transition-colors relative overflow-hidden",
                  critical && "border-l-destructive border-l-2"
                )}
                onClick={() => { setSelectedReview(review); setCommentLetter(""); setCopied(false); }}
              >
                <CardContent className="p-4 grid grid-cols-1 md:grid-cols-[1fr_100px_120px_80px_100px_80px_24px] gap-2 md:gap-4 items-center">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{review.project?.name || "Unnamed"}</p>
                    <p className="text-xs text-muted-foreground truncate">{review.project?.address}</p>
                  </div>
                  <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-medium capitalize w-fit">{review.project?.trade_type}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-medium">{getCountyLabel(review.project?.county || "")}</span>
                    {isHVHZ(review.project?.county || "") && (
                      <Wind className="h-3 w-3 text-destructive" />
                    )}
                  </div>
                  <Badge variant="secondary" className="text-xs w-fit">R{review.round}</Badge>
                  <Badge
                    className={cn("text-[10px] w-fit", {
                      "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/20": review.ai_check_status === "complete",
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
            <SheetTitle className="font-[var(--font-display)] text-xl">
              {selectedReview?.project?.name || "Plan Review"}
            </SheetTitle>
          </SheetHeader>

          {selectedReview && (
            <div className="mt-6 space-y-5">
              {/* Project info header */}
              <Card className="shadow-subtle border">
                <CardContent className="p-4 space-y-2">
                  <p className="text-sm text-foreground/80">{selectedReview.project?.address}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-medium capitalize">{selectedReview.project?.trade_type}</span>
                    <Badge variant="secondary" className="text-xs">Round {selectedReview.round}</Badge>
                    <Badge variant="outline" className="text-xs font-medium">
                      {getCountyLabel(county)} County
                    </Badge>
                    {selectedReview.project?.jurisdiction && (
                      <span className="text-[10px] text-muted-foreground">
                        Jurisdiction: {selectedReview.project.jurisdiction}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* HVHZ Banner */}
              {hvhz && (
                <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                  <Wind className="h-5 w-5 text-destructive shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-destructive">HVHZ — High Velocity Hurricane Zone</p>
                    <p className="text-xs text-destructive/80">Enhanced wind load & impact protection requirements apply per FBC 1626 and Miami-Dade TAS 201/202/203.</p>
                  </div>
                </div>
              )}

              {/* AI Pre-Check button */}
              <Button
                onClick={() => runAICheck(selectedReview)}
                disabled={aiRunning}
                className="w-full h-12 text-sm font-medium bg-accent text-accent-foreground hover:bg-accent/90"
              >
                {aiRunning ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Analyzing Plans...</>
                ) : (
                  <><Sparkles className="h-4 w-4 mr-2" /> Run AI Pre-Check{county ? ` (${getCountyLabel(county)})` : ""}</>
                )}
              </Button>

              {/* Multi-step scanning animation */}
              {aiRunning && (
                <div className="space-y-3 rounded-lg border bg-card p-4">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Scanning disciplines...</span>
                    <span>{scanStep + 1}/{SCANNING_STEPS.length}</span>
                  </div>
                  <Progress value={((scanStep + 1) / SCANNING_STEPS.length) * 100} className="h-1.5" />
                  <div className="grid grid-cols-3 gap-2">
                    {SCANNING_STEPS.map((step, i) => {
                      const Icon = getDisciplineIcon(step.discipline);
                      const active = i === scanStep;
                      const done = i < scanStep;
                      return (
                        <div
                          key={step.discipline}
                          className={cn(
                            "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] transition-all",
                            active && "bg-accent/10 text-accent font-medium",
                            done && "text-[hsl(var(--success))]",
                            !active && !done && "text-muted-foreground/40"
                          )}
                        >
                          <Icon className={cn("h-3 w-3", active && "animate-pulse")} />
                          {step.label}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Findings summary bar */}
              {findings.length > 0 && (
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm font-semibold">{findings.length} Findings</span>
                  {criticalCount > 0 && (
                    <Badge className={cn("text-[10px]", severityColors.critical)}>
                      {criticalCount} Critical
                    </Badge>
                  )}
                  {majorCount > 0 && (
                    <Badge className={cn("text-[10px]", severityColors.major)}>
                      {majorCount} Major
                    </Badge>
                  )}
                  {minorCount > 0 && (
                    <Badge className={cn("text-[10px]", severityColors.minor)}>
                      {minorCount} Minor
                    </Badge>
                  )}
                </div>
              )}

              {/* Findings grouped by discipline */}
              {findings.length > 0 && (
                <Accordion type="multiple" defaultValue={DISCIPLINE_ORDER.filter((d) => groupedFindings[d])} className="space-y-1">
                  {DISCIPLINE_ORDER.filter((d) => groupedFindings[d]).map((discipline) => {
                    const group = groupedFindings[discipline];
                    const Icon = getDisciplineIcon(discipline);
                    const worst = getWorstSeverity(group);
                    return (
                      <AccordionItem key={discipline} value={discipline} className="border rounded-lg overflow-hidden">
                        <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/30">
                          <div className="flex items-center gap-3">
                            <Icon className={cn("h-4 w-4", getDisciplineColor(discipline))} />
                            <span className="text-sm font-medium">{getDisciplineLabel(discipline)}</span>
                            <Badge variant="secondary" className="text-[10px]">{group.length}</Badge>
                            <div className={cn("h-2 w-2 rounded-full", {
                              "bg-destructive": worst === "critical",
                              "bg-[hsl(var(--warning))]": worst === "major",
                              "bg-muted-foreground/40": worst === "minor",
                            })} />
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-4 pb-4 space-y-2">
                          {group.map((finding, i) => (
                            <FindingCard key={i} finding={finding} index={i} />
                          ))}
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              )}

              {/* Comment Letter */}
              {findings.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Comment Letter</h3>
                    <div className="flex gap-2">
                      {commentLetter && !generatingLetter && (
                        <Button size="sm" variant="outline" onClick={copyLetter}>
                          {copied ? <Check className="h-3.5 w-3.5 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
                          {copied ? "Copied" : "Copy"}
                        </Button>
                      )}
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
                  </div>
                  {(commentLetter || generatingLetter) && (
                    <div className="rounded-lg border-2 border-border bg-card shadow-sm">
                      {/* Letterhead bar */}
                      <div className="border-b bg-muted/30 px-6 py-3">
                        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                          Florida Private Providers — Official Comment Letter
                        </p>
                      </div>
                      <Textarea
                        value={commentLetter}
                        onChange={(e) => setCommentLetter(e.target.value)}
                        rows={16}
                        className="font-[var(--font-mono)] text-xs border-0 rounded-none focus-visible:ring-0 focus-visible:ring-offset-0 resize-y"
                        placeholder={generatingLetter ? "Generating letter..." : ""}
                      />
                    </div>
                  )}
                  {commentLetter && !generatingLetter && (
                    <Button size="sm" className="bg-accent text-accent-foreground hover:bg-accent/90">
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
