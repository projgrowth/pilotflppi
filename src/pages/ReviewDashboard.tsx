import { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Play, Loader2, FileDown, Layers, Sparkles, Square, Inbox } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import ReviewHealthStrip from "@/components/review-dashboard/ReviewHealthStrip";
import DeficiencyList from "@/components/review-dashboard/DeficiencyList";
import TriageInbox from "@/components/review-dashboard/TriageInbox";
import HumanReviewQueue from "@/components/review-dashboard/HumanReviewQueue";
import ProjectDNAViewer from "@/components/review-dashboard/ProjectDNAViewer";
import DnaHealthBanner from "@/components/review-dashboard/DnaHealthBanner";
import CitationDbBanner from "@/components/review-dashboard/CitationDbBanner";
import SheetCoverageMap from "@/components/review-dashboard/SheetCoverageMap";
import DeferredScopePanel from "@/components/review-dashboard/DeferredScopePanel";
import DedupeAuditTrail from "@/components/review-dashboard/DedupeAuditTrail";
import LetterQualityGate from "@/components/review-dashboard/LetterQualityGate";
import ReviewerMemoryCard from "@/components/review-dashboard/ReviewerMemoryCard";
import { useDeficienciesV2, useDeferredScope, useProjectDna, useSheetCoverage, usePipelineStatus } from "@/hooks/useReviewDashboard";
import { useFirmSettings } from "@/hooks/useFirmSettings";
import { generateCountyReport } from "@/lib/county-report";
import { determineReviewStatus } from "@/lib/review-status";
import { cancelPipelineForReview } from "@/lib/pipeline-cancel";
import { usePipelineErrorStream } from "@/hooks/usePipelineErrors";

interface ReviewWithProject {
  id: string;
  project_id: string;
  round: number;
  qc_status: string;
  comment_letter_draft: string | null;
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
  const [runningDeep, setRunningDeep] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // Triage is now the default landing tab — surfaces priority items first.
  const [activeTab, setActiveTab] = useState("triage");

  // Toast on pipeline error so reviewers don't have to refresh to find out.
  usePipelineErrorStream(id, (err) => {
    toast.error(`${err.stage.replace(/_/g, " ")} failed`, {
      description: err.error_message?.slice(0, 140) ?? "Unknown error",
      duration: 8000,
    });
  });

  const runPipeline = async (mode: "core" | "deep" = "core") => {
    if (!id) return;
    const setter = mode === "deep" ? setRunningDeep : setRunning;
    setter(true);
    try {
      // Clear any prior cancellation marker so the new run isn't aborted
      // on its first heartbeat.
      await supabase
        .from("plan_reviews")
        .update({ ai_run_progress: { cancelled_at: null } })
        .eq("id", id);
      const { error } = await supabase.functions.invoke("run-review-pipeline", {
        body: { plan_review_id: id, mode },
      });
      if (error) throw error;
      toast.success(
        mode === "deep"
          ? "Deep QA started — verify, citations, cross-check, deferred scope, prioritize"
          : "Core analysis started — watch the stepper for live progress",
      );
      qc.invalidateQueries({ queryKey: ["pipeline_status", id] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Pipeline failed to start";
      toast.error(msg);
    } finally {
      setter(false);
    }
  };

  const cancelPipeline = async () => {
    if (!id) return;
    setCancelling(true);
    try {
      await cancelPipelineForReview(id);
      qc.invalidateQueries({ queryKey: ["pipeline_status", id] });
      qc.invalidateQueries({ queryKey: ["pipeline-activity-all"] });
      toast.success("Pipeline cancelled");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to cancel");
    } finally {
      setCancelling(false);
    }
  };

  const { data: review } = useQuery({
    queryKey: ["plan_review_dashboard", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plan_reviews")
        .select(
          "id, project_id, round, qc_status, comment_letter_draft, project:projects(name, address, jurisdiction, county)",
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
  const { data: pipeRows = [] } = usePipelineStatus(id);
  const { firmSettings } = useFirmSettings();

  const dedupeMergeCount = useMemo(() => {
    const row = pipeRows.find((r) => r.stage === "dedupe");
    const meta = (row as unknown as { metadata?: { groups_merged?: number } } | undefined)
      ?.metadata;
    return meta?.groups_merged ?? 0;
  }, [pipeRows]);

  const isPipelineActive = useMemo(
    () => pipeRows.some((r) => r.status === "running" || r.status === "pending"),
    [pipeRows],
  );

  const status = useMemo(() => determineReviewStatus(defs), [defs]);
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
          <Button
            size="sm"
            onClick={handleGenerateReport}
            disabled={!review?.project}
          >
            <FileDown className="mr-1 h-4 w-4" />
            Generate Report
          </Button>
          <Button asChild variant="default" size="sm">
            <Link to={`/plan-review/${id}`}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Back to workspace
            </Link>
          </Button>
          {isPipelineActive && (
            <Button
              size="sm"
              variant="destructive"
              onClick={cancelPipeline}
              disabled={cancelling}
              title="Stop the running pipeline"
            >
              {cancelling ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Square className="mr-1 h-4 w-4" />
              )}
              {cancelling ? "Cancelling…" : "Cancel"}
            </Button>
          )}
          {/* Re-run analysis is a secondary action — the wizard handles the
              first run automatically. Keep this for follow-up rounds where
              the reviewer uploads new sheets. */}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => runPipeline("core")}
            disabled={running}
            title="Re-run the core analysis pipeline"
          >
            {running ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-1 h-4 w-4" />
            )}
            {running ? "Running…" : "Re-run Core"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => runPipeline("deep")}
            disabled={runningDeep}
            title="Run Deep QA: verify, citations, cross-check, deferred scope, prioritize"
          >
            {runningDeep ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-1 h-4 w-4" />
            )}
            {runningDeep ? "Deep QA…" : "Run Deep QA"}
          </Button>
        </div>
      </div>

      {review?.project && (
        <DnaHealthBanner
          planReviewId={id}
          projectCounty={review.project.county}
          onJumpToDna={() => setActiveTab("dna")}
        />
      )}

      <CitationDbBanner />

      {review?.project && (
        <ReviewHealthStrip
          planReviewId={id}
          status={status}
          projectName={review.project.name}
          projectAddress={review.project.address}
          jurisdiction={review.project.jurisdiction || review.project.county}
        />
      )}

      <LetterQualityGate
        planReviewId={id}
        letterDraft={review?.comment_letter_draft ?? null}
        onJumpToFinding={() => setActiveTab("deficiencies")}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList>
          <TabsTrigger value="deficiencies">Deficiencies</TabsTrigger>
          <TabsTrigger value="human">Human Review</TabsTrigger>
          <TabsTrigger value="deferred">
            Deferred Scope{deferredItems.length > 0 ? ` (${deferredItems.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="audit">
            <Layers className="mr-1 h-3.5 w-3.5" />
            Dedupe Audit{dedupeMergeCount > 0 ? ` (${dedupeMergeCount})` : ""}
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
        <TabsContent value="audit" className="mt-4">
          <DedupeAuditTrail
            planReviewId={id}
            onJump={() => setActiveTab("deficiencies")}
          />
        </TabsContent>
        <TabsContent value="dna" className="mt-4">
          <ProjectDNAViewer
            planReviewId={id}
            jurisdictionMismatch={jurisdictionMismatch}
            onAfterRerun={() => setActiveTab("deficiencies")}
          />
        </TabsContent>
        <TabsContent value="coverage" className="mt-4">
          <SheetCoverageMap planReviewId={id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
