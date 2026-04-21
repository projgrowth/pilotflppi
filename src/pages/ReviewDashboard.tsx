import { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Play, Loader2, FileDown } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import ReviewStatusBar from "@/components/review-dashboard/ReviewStatusBar";
import ReviewSummaryHeader from "@/components/review-dashboard/ReviewSummaryHeader";
import CrossCheckBanner from "@/components/review-dashboard/CrossCheckBanner";
import VerificationBanner from "@/components/review-dashboard/VerificationBanner";
import ReviewerMemoryCard from "@/components/review-dashboard/ReviewerMemoryCard";
import DeficiencyList from "@/components/review-dashboard/DeficiencyList";
import HumanReviewQueue from "@/components/review-dashboard/HumanReviewQueue";
import ProjectDNAViewer from "@/components/review-dashboard/ProjectDNAViewer";
import SheetCoverageMap from "@/components/review-dashboard/SheetCoverageMap";
import DeferredScopePanel from "@/components/review-dashboard/DeferredScopePanel";
import { useDeficienciesV2, useDeferredScope, useProjectDna, useSheetCoverage } from "@/hooks/useReviewDashboard";
import { useFirmSettings } from "@/hooks/useFirmSettings";
import { generateCountyReport } from "@/lib/county-report";

interface ReviewWithProject {
  id: string;
  project_id: string;
  round: number;
  qc_status: string;
  project: {
    name: string;
    address: string;
    jurisdiction: string;
    county: string;
  } | null;
}

export default function ReviewDashboard() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);

  const runPipeline = async () => {
    if (!id) return;
    setRunning(true);
    try {
      const { error } = await supabase.functions.invoke("run-review-pipeline", {
        body: { plan_review_id: id },
      });
      if (error) throw error;
      toast.success("Pipeline run complete");
      qc.invalidateQueries({ queryKey: ["pipeline_status", id] });
      qc.invalidateQueries({ queryKey: ["deficiencies_v2", id] });
      qc.invalidateQueries({ queryKey: ["project_dna", id] });
      qc.invalidateQueries({ queryKey: ["sheet_coverage", id] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Pipeline failed";
      toast.error(msg);
    } finally {
      setRunning(false);
    }
  };

  const { data: review } = useQuery({
    queryKey: ["plan_review_dashboard", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plan_reviews")
        .select(
          "id, project_id, round, qc_status, project:projects(name, address, jurisdiction, county)",
        )
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as ReviewWithProject | null;
    },
  });

  const { data: dna } = useProjectDna(id);
  const { data: defs = [] } = useDeficienciesV2(id);
  const { data: sheets = [] } = useSheetCoverage(id);
  const { data: deferredItems = [] } = useDeferredScope(id);
  const { firmSettings } = useFirmSettings();

  const status = useMemo(() => determineStatus(defs), [defs]);
  const jurisdictionMismatch =
    !!dna &&
    !!review?.project?.county &&
    !!dna.county &&
    dna.county.toLowerCase() !== review.project.county.toLowerCase();

  const handleGenerateReport = () => {
    if (!review?.project) {
      toast.error("Project not loaded yet");
      return;
    }
    try {
      generateCountyReport({
        status,
        round: review.round,
        project: {
          name: review.project.name,
          address: review.project.address,
          jurisdiction: review.project.jurisdiction || review.project.county,
          county: review.project.county,
        },
        dna: dna ?? null,
        sheets,
        deficiencies: defs,
        deferredItems,
        firm: firmSettings ?? null,
      });
      toast.success("Report ready — choose Save as PDF in the print dialog");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to generate report");
    }
  };

  if (!id) return null;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <PageHeader
          title="Review Dashboard"
          subtitle={
            review?.project
              ? `${review.project.name} · Round ${review.round}`
              : "Loading…"
          }
        />
        <div className="flex items-center gap-2">
          <StatusPill status={status} />
          <Button size="sm" onClick={runPipeline} disabled={running}>
            {running ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-1 h-4 w-4" />
            )}
            {running ? "Running…" : "Run Pipeline"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleGenerateReport}
            disabled={!review?.project}
          >
            <FileDown className="mr-1 h-4 w-4" />
            Generate Report
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to={`/plan-review/${id}`}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Back to workspace
            </Link>
          </Button>
        </div>
      </div>

      <ReviewStatusBar planReviewId={id} />

      <VerificationBanner planReviewId={id} />

      <ReviewerMemoryCard planReviewId={id} />

      <CrossCheckBanner planReviewId={id} />

      {review?.project && (
        <ReviewSummaryHeader
          planReviewId={id}
          projectName={review.project.name}
          projectAddress={review.project.address}
          jurisdiction={review.project.jurisdiction || review.project.county}
        />
      )}

      <Tabs defaultValue="deficiencies" className="w-full">
        <TabsList>
          <TabsTrigger value="deficiencies">Deficiencies</TabsTrigger>
          <TabsTrigger value="human">Human Review</TabsTrigger>
          <TabsTrigger value="deferred">
            Deferred Scope{deferredItems.length > 0 ? ` (${deferredItems.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="dna">Project DNA</TabsTrigger>
          <TabsTrigger value="coverage">Sheet Coverage</TabsTrigger>
        </TabsList>
        <TabsContent value="deficiencies" className="mt-4">
          <DeficiencyList planReviewId={id} />
        </TabsContent>
        <TabsContent value="human" className="mt-4">
          <HumanReviewQueue planReviewId={id} />
        </TabsContent>
        <TabsContent value="deferred" className="mt-4">
          <DeferredScopePanel planReviewId={id} />
        </TabsContent>
        <TabsContent value="dna" className="mt-4">
          <ProjectDNAViewer planReviewId={id} jurisdictionMismatch={jurisdictionMismatch} />
        </TabsContent>
        <TabsContent value="coverage" className="mt-4">
          <SheetCoverageMap planReviewId={id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type ReviewStatus =
  | "approved"
  | "approved_with_conditions"
  | "revise_resubmit"
  | "incomplete";

function determineStatus(
  defs: { life_safety_flag: boolean; permit_blocker: boolean; priority: string; status: string; requires_human_review: boolean }[],
): ReviewStatus {
  const unresolvedHumanReview = defs.some(
    (d) => d.requires_human_review && d.status === "open",
  );
  if (unresolvedHumanReview) return "incomplete";

  const unresolvedHigh = defs.some(
    (d) => d.priority === "high" && d.status !== "resolved" && d.status !== "waived",
  );
  if (unresolvedHigh) return "revise_resubmit";

  const unresolvedBlocker = defs.some(
    (d) =>
      (d.life_safety_flag || d.permit_blocker) &&
      d.status !== "resolved" &&
      d.status !== "waived",
  );
  if (unresolvedBlocker) return "revise_resubmit";

  const openMedium = defs.some(
    (d) => d.priority === "medium" && d.status === "open",
  );
  if (openMedium) return "approved_with_conditions";

  return "approved";
}

function StatusPill({ status }: { status: ReviewStatus }) {
  const map: Record<ReviewStatus, { label: string; cls: string }> = {
    approved: {
      label: "Approved",
      cls: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400",
    },
    approved_with_conditions: {
      label: "Approved with Conditions",
      cls: "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400",
    },
    revise_resubmit: {
      label: "Revise & Resubmit",
      cls: "bg-destructive/10 text-destructive border-destructive/30",
    },
    incomplete: {
      label: "Incomplete Review",
      cls: "bg-muted text-foreground border-border",
    },
  };
  const cfg = map[status];
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium ${cfg.cls}`}
    >
      {cfg.label}
    </span>
  );
}
