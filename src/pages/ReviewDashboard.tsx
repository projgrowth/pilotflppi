import { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Play, Loader2, FileDown, Layers } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import ReviewHealthStrip from "@/components/review-dashboard/ReviewHealthStrip";
import DeficiencyList from "@/components/review-dashboard/DeficiencyList";
import HumanReviewQueue from "@/components/review-dashboard/HumanReviewQueue";
import ProjectDNAViewer from "@/components/review-dashboard/ProjectDNAViewer";
import DnaHealthBanner from "@/components/review-dashboard/DnaHealthBanner";
import SheetCoverageMap from "@/components/review-dashboard/SheetCoverageMap";
import DeferredScopePanel from "@/components/review-dashboard/DeferredScopePanel";
import DedupeAuditTrail from "@/components/review-dashboard/DedupeAuditTrail";
import { useDeficienciesV2, useDeferredScope, useProjectDna, useSheetCoverage, usePipelineStatus } from "@/hooks/useReviewDashboard";
import { useFirmSettings } from "@/hooks/useFirmSettings";
import { generateCountyReport } from "@/lib/county-report";
import { determineReviewStatus } from "@/lib/review-status";

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
  const [activeTab, setActiveTab] = useState("deficiencies");

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
  const { data: pipeRows = [] } = usePipelineStatus(id);
  const { firmSettings } = useFirmSettings();

  const dedupeMergeCount = useMemo(() => {
    const row = pipeRows.find((r) => r.stage === "dedupe");
    const meta = (row as unknown as { metadata?: { groups_merged?: number } } | undefined)
      ?.metadata;
    return meta?.groups_merged ?? 0;
  }, [pipeRows]);

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

      {review?.project && (
        <DnaHealthBanner
          planReviewId={id}
          projectCounty={review.project.county}
          onJumpToDna={() => setActiveTab("dna")}
        />
      )}

      {review?.project && (
        <ReviewHealthStrip
          planReviewId={id}
          status={status}
          projectName={review.project.name}
          projectAddress={review.project.address}
          jurisdiction={review.project.jurisdiction || review.project.county}
        />
      )}

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

