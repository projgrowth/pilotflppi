import { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Play,
  Loader2,
  FileDown,
  Sparkles,
  Square,
  Inbox,
  Wand2,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ReviewHealthStrip from "@/components/review-dashboard/ReviewHealthStrip";
import DeficiencyList from "@/components/review-dashboard/DeficiencyList";
import TriageInbox from "@/components/review-dashboard/TriageInbox";
import DashboardAlertStack, {
  type DashboardAlert,
} from "@/components/review-dashboard/DashboardAlertStack";
import NextStepBar from "@/components/review-dashboard/NextStepBar";
import FilterChips from "@/components/review-dashboard/FilterChips";
import AuditCoveragePanel from "@/components/review-dashboard/AuditCoveragePanel";
import LetterReadinessGate from "@/components/plan-review/LetterReadinessGate";
import LetterSnapshotViewer from "@/components/plan-review/LetterSnapshotViewer";
import StatutoryCompliancePanel from "@/components/plan-review/StatutoryCompliancePanel";
import { CRITICAL_DNA_FIELDS } from "@/lib/dna-fields";
import { detectThresholdBuilding } from "@/lib/threshold-building";
import { useLetterQualityCheck } from "@/hooks/useLetterQualityCheck";
import {
  useDeficienciesV2,
  useDeferredScope,
  useProjectDna,
  useSheetCoverage,
  usePipelineStatus,
} from "@/hooks/useReviewDashboard";
import { useFirmSettings } from "@/hooks/useFirmSettings";
import { useReviewCoveragePct } from "@/hooks/useReviewCoverage";
import { generateCountyReport } from "@/lib/county-report";
import { determineReviewStatus } from "@/lib/review-status";
import { cancelPipelineForReview } from "@/lib/pipeline-cancel";
import { usePipelineErrorStream } from "@/hooks/usePipelineErrors";
import { reprepareInBrowser } from "@/lib/reprepare-in-browser";
import type { ChipFilter } from "@/hooks/useFilteredDeficiencies";

interface ReviewWithProject {
  id: string;
  project_id: string;
  round: number;
  qc_status: string;
  comment_letter_draft: string | null;
  notice_to_building_official_filed_at: string | null;
  compliance_affidavit_signed_at: string | null;
  special_inspector_designated: boolean | null;
  special_inspector_name: string | null;
  special_inspector_license: string | null;
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
  const [reprepping, setReprepping] = useState(false);
  const [activeTab, setActiveTab] = useState("triage");
  const [chipFilter, setChipFilter] = useState<ChipFilter>("all");

  // ── Data ────────────────────────────────────────────────────────────────
  const { data: review } = useQuery({
    queryKey: ["plan_review_dashboard", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plan_reviews")
        .select(
          "id, project_id, round, qc_status, comment_letter_draft, notice_to_building_official_filed_at, compliance_affidavit_signed_at, special_inspector_designated, special_inspector_name, special_inspector_license, project:projects(name, address, jurisdiction, county)",
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
  const { data: coveragePct = null } = useReviewCoveragePct(id);
  const { data: citationCount } = useQuery({
    queryKey: ["fbc_code_sections_count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("fbc_code_sections")
        .select("id", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Pull the signing reviewer's per-discipline professional licenses so the
  // readiness gate can block sending letters that include disciplines the
  // reviewer isn't licensed to sign for (F.S. 553.791(2)).
  const { data: reviewerLicensedDisciplines = [] } = useQuery({
    queryKey: ["reviewer_discipline_licenses_self"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [] as string[];
      const { data, error } = await supabase
        .from("profiles")
        .select("discipline_licenses")
        .eq("id", user.id)
        .maybeSingle();
      if (error) throw error;
      const map = (data?.discipline_licenses ?? {}) as Record<string, unknown>;
      return Object.entries(map)
        .filter(([, v]) => typeof v === "string" && v.trim().length > 0)
        .map(([k]) => k.toLowerCase());
    },
    staleTime: 60 * 1000,
  });
  const letterCheck = useLetterQualityCheck({
    deficiencies: defs,
    letterDraft: review?.comment_letter_draft ?? null,
  });

  // ── Derived state ───────────────────────────────────────────────────────
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

  const preparePagesErrored = useMemo(() => {
    const row = pipeRows.find((r) => r.stage === "prepare_pages");
    if (!row || row.status !== "error") return false;
    const meta = (row as unknown as { metadata?: { error_class?: string } } | undefined)
      ?.metadata;
    const msg = (row.error_message ?? "").toLowerCase();
    return (
      meta?.error_class === "needs_browser_rasterization" ||
      msg.includes("re-prepare") ||
      msg.includes("haven't been prepared")
    );
  }, [pipeRows]);

  const lastErrorStage = useMemo(() => {
    if (isPipelineActive) return null;
    const errored = pipeRows.find((r) => r.status === "error");
    return errored?.stage ?? null;
  }, [pipeRows, isPipelineActive]);

  const status = useMemo(() => determineReviewStatus(defs), [defs]);
  const jurisdictionMismatch =
    !!dna &&
    !!review?.project?.county &&
    !!dna.county &&
    dna.county.toLowerCase() !== review.project.county.toLowerCase();

  // DNA blocker detection (mirrors DnaHealthBanner without dragging the whole banner in).
  const dnaIssue = useMemo(() => {
    if (!dna) return null;
    const cm: string[] = [];
    for (const f of CRITICAL_DNA_FIELDS) {
      const v = (dna as unknown as Record<string, unknown>)[f];
      if (v === null || v === undefined || v === "") cm.push(f);
    }
    const completeness =
      (CRITICAL_DNA_FIELDS.length - cm.length) / CRITICAL_DNA_FIELDS.length;
    const blocked = cm.includes("county") || jurisdictionMismatch || completeness < 0.5;
    if (blocked) return { severity: "danger" as const, missing: cm };
    if (cm.length > 0) return { severity: "warn" as const, missing: cm };
    return null;
  }, [dna, jurisdictionMismatch]);

  // ── Filter chip counts ──────────────────────────────────────────────────
  const liveDefs = useMemo(
    () =>
      defs.filter(
        (d) =>
          d.verification_status !== "overturned" &&
          d.verification_status !== "superseded",
      ),
    [defs],
  );
  const chipCounts = useMemo(
    () => ({
      all: liveDefs.length,
      needsEyes: liveDefs.filter((d) => d.requires_human_review).length,
      lifeSafety: liveDefs.filter((d) => d.life_safety_flag || d.permit_blocker).length,
      lowConfidence: liveDefs.filter(
        (d) => typeof d.confidence_score === "number" && d.confidence_score < 0.7,
      ).length,
      deferred: liveDefs.filter((d) => d.status === "needs_info").length,
    }),
    [liveDefs],
  );

  // ── Recovery & pipeline actions ────────────────────────────────────────
  const handleReprepareInBrowser = async () => {
    if (!id || reprepping) return;
    setReprepping(true);
    const t = toast.loading("Re-preparing pages in your browser…");
    try {
      const result = await reprepareInBrowser(id);
      toast.dismiss(t);
      if (result.ok) {
        toast.success(result.message);
        qc.invalidateQueries({ queryKey: ["pipeline_status", id] });
      } else {
        toast.error(result.message);
      }
      for (const w of result.warnings) toast.warning(w);
    } catch (e) {
      toast.dismiss(t);
      toast.error(e instanceof Error ? e.message : "Re-prepare failed");
    } finally {
      setReprepping(false);
    }
  };

  usePipelineErrorStream(id, (err) => {
    const isNeedsBrowser = err.error_class === "needs_browser_rasterization";
    toast.error(`${err.stage.replace(/_/g, " ")} failed`, {
      description: isNeedsBrowser
        ? "Pages haven't been prepared. Click Re-prepare to render them in your browser."
        : err.error_message?.slice(0, 140) ?? "Unknown error",
      duration: isNeedsBrowser ? 15000 : 8000,
      action: isNeedsBrowser
        ? {
            label: "Re-prepare in browser",
            onClick: () => void handleReprepareInBrowser(),
          }
        : undefined,
    });
  });

  const runPipeline = async (mode: "core" | "deep" = "core") => {
    if (!id) return;
    const setter = mode === "deep" ? setRunningDeep : setRunning;
    setter(true);
    try {
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
      toast.error(e instanceof Error ? e.message : "Pipeline failed to start");
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

  // ── Build the alert stack from existing state ──────────────────────────
  const alerts = useMemo<DashboardAlert[]>(() => {
    const out: DashboardAlert[] = [];
    if (preparePagesErrored) {
      out.push({
        id: "reprepare",
        severity: "danger",
        title: "Pages need to be re-prepared in your browser",
        description:
          "The server can't rasterize PDFs directly. Your browser will render them with pdf.js (10–30s).",
        actionLabel: reprepping ? "Re-preparing…" : "Re-prepare in browser",
        onAction: handleReprepareInBrowser,
        busy: reprepping,
        icon: Wand2,
      });
    }
    if (dnaIssue?.severity === "danger") {
      out.push({
        id: "dna-blocked",
        severity: "danger",
        title: "Project DNA extraction incomplete — findings paused",
        description: jurisdictionMismatch
          ? `Extracted county "${dna?.county}" doesn't match project county "${review?.project?.county}".`
          : `Missing critical fields: ${dnaIssue.missing.slice(0, 3).join(", ")}`,
        actionLabel: "Fix in Project DNA",
        onAction: () => setActiveTab("audit"),
      });
    } else if (dnaIssue?.severity === "warn") {
      out.push({
        id: "dna-warn",
        severity: "warn",
        title: "Project DNA partially extracted",
        description: `${dnaIssue.missing.length} field(s) missing — findings may be incomplete.`,
        actionLabel: "Open Project DNA",
        onAction: () => setActiveTab("audit"),
      });
    }
    if (letterCheck.errorCount > 0) {
      out.push({
        id: "letter-blocking",
        severity: "warn",
        title: `${letterCheck.errorCount} blocking letter issue${letterCheck.errorCount === 1 ? "" : "s"}`,
        description: "Resolve before generating the contractor letter.",
      });
    }
    if (citationCount === 0) {
      out.push({
        id: "citations",
        severity: "info",
        title: "FBC citation database not seeded",
        description:
          "Citation grounding unavailable — all findings show as unverified until seeded.",
      });
    }
    return out;
  }, [
    preparePagesErrored,
    reprepping,
    dnaIssue,
    jurisdictionMismatch,
    dna?.county,
    review?.project?.county,
    letterCheck.errorCount,
    citationCount,
  ]);

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
    <div className="mx-auto w-full max-w-7xl space-y-4 p-6">
      {/* Header — primary action right, secondary in a Re-run dropdown */}
      <div className="flex items-center justify-between gap-3">
        <PageHeader
          title="Triage"
          subtitle={
            review?.project
              ? `${review.project.name} · Round ${review.round}`
              : "Loading…"
          }
        />
        <div className="flex items-center gap-2">
          {lastErrorStage && (
            <span className="text-2xs text-destructive">
              Last run errored at <span className="font-mono">{lastErrorStage}</span>
            </span>
          )}
          {isPipelineActive && (
            <Button
              size="sm"
              variant="destructive"
              onClick={cancelPipeline}
              disabled={cancelling}
            >
              {cancelling ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Square className="mr-1 h-4 w-4" />
              )}
              {cancelling ? "Cancelling…" : "Cancel"}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={running || runningDeep}>
                {running || runningDeep ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-1 h-4 w-4" />
                )}
                Re-run
                <ChevronDown className="ml-1 h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => runPipeline("core")} disabled={running}>
                <Play className="mr-2 h-3.5 w-3.5" />
                Re-run Core
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => runPipeline("deep")} disabled={runningDeep}>
                <Sparkles className="mr-2 h-3.5 w-3.5" />
                Run Deep QA
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button asChild size="sm" variant="outline">
            <Link to={`/plan-review/${id}`}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Workspace
            </Link>
          </Button>
          <Button size="sm" onClick={handleGenerateReport} disabled={!review?.project}>
            <FileDown className="mr-1 h-4 w-4" />
            Generate Report
          </Button>
        </div>
      </div>

      {/* Single-slot alert stack — replaces 4 stacked banners */}
      <DashboardAlertStack alerts={alerts} />

      {/* Sticky health strip — always reachable */}
      {review?.project && (
        <div className="sticky top-0 z-20 -mx-6 bg-background/95 px-6 py-1 backdrop-blur">
          <ReviewHealthStrip
            planReviewId={id}
            status={status}
            projectName={review.project.name}
            projectAddress={review.project.address}
            jurisdiction={review.project.jurisdiction || review.project.county}
          />
        </div>
      )}

      {/* F.S. 553.791 statutory prerequisites — Notice + Affidavit per round */}
      {review && id && (
        <StatutoryCompliancePanel
          planReviewId={id}
          round={review.round}
          noticeFiledAt={review.notice_to_building_official_filed_at}
          affidavitSignedAt={review.compliance_affidavit_signed_at}
          isThresholdBuilding={detectThresholdBuilding(dna).isThresholdBuilding}
          thresholdTriggers={detectThresholdBuilding(dna).triggers}
          specialInspectorDesignated={!!review.special_inspector_designated}
          specialInspectorName={review.special_inspector_name}
          specialInspectorLicense={review.special_inspector_license}
        />
      )}

      {/* Letter readiness checklist — shown when there are findings to send */}
      {defs.length > 0 && (
        <LetterReadinessGate
          findings={defs}
          qcStatus={review?.qc_status}
          reviewerIsSoleSigner={true}
          projectDnaMissingFields={dnaIssue?.missing ?? []}
          noticeToBuildingOfficialFiledAt={review?.notice_to_building_official_filed_at}
          complianceAffidavitSignedAt={review?.compliance_affidavit_signed_at}
          disciplinesInLetter={Array.from(
            new Set(
              defs
                .filter((f) => (f.status ?? "open") === "open" || f.status === "needs_info")
                .map((f) => (f.discipline ?? "").toLowerCase())
                .filter(Boolean),
            ),
          )}
          reviewerLicensedDisciplines={reviewerLicensedDisciplines}
          isThresholdBuilding={detectThresholdBuilding(dna).isThresholdBuilding}
          thresholdTriggers={detectThresholdBuilding(dna).triggers}
          specialInspectorDesignated={!!review?.special_inspector_designated}
          coveragePct={coveragePct}
          blockLetterOnLowCoverage={firmSettings?.block_letter_on_low_coverage ?? true}
          blockLetterOnUngrounded={firmSettings?.block_letter_on_ungrounded ?? true}
          onJumpToFinding={() => setActiveTab("triage")}
        />
      )}

      {/* Single-CTA next-step bar */}
      <NextStepBar
        pipelineRows={pipeRows.map((r) => ({ stage: r.stage, status: r.status }))}
        deficiencies={defs.map((d) => ({
          reviewer_disposition: d.reviewer_disposition,
          verification_status: d.verification_status,
          status: d.status,
        }))}
        letterDraft={review?.comment_letter_draft}
        qcStatus={review?.qc_status}
        onTriage={() => setActiveTab("triage")}
        onGenerateLetter={() => setActiveTab("findings")}
        onReviewLetter={() => setActiveTab("findings")}
      />

      {/* Three top-level tabs only */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList>
          <TabsTrigger value="triage">
            <Inbox className="mr-1 h-3.5 w-3.5" />
            Triage
            {chipCounts.needsEyes > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-500/20 px-1.5 font-mono text-2xs text-amber-700 dark:text-amber-400">
                {chipCounts.needsEyes}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="findings">All findings</TabsTrigger>
          <TabsTrigger value="audit">Audit & Coverage</TabsTrigger>
          <TabsTrigger value="history">Sent letters</TabsTrigger>
        </TabsList>

        <TabsContent value="triage" className="mt-4">
          <TriageInbox planReviewId={id} />
        </TabsContent>

        <TabsContent value="findings" className="mt-4 space-y-4">
          <FilterChips active={chipFilter} onChange={setChipFilter} counts={chipCounts} />
          <DeficiencyList
            planReviewId={id}
            chipFilter={chipFilter === "all" ? undefined : chipFilter}
          />
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <AuditCoveragePanel
            planReviewId={id}
            jurisdictionMismatch={jurisdictionMismatch}
            dedupeMergeCount={dedupeMergeCount}
            onJumpToFindings={() => setActiveTab("findings")}
            onAfterDnaRerun={() => setActiveTab("triage")}
          />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          {id && <LetterSnapshotViewer planReviewId={id} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}
