import { useMemo } from "react";
import { AlertTriangle, ShieldOff, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  usePipelineStatus,
  useProjectDna,
} from "@/hooks/useReviewDashboard";

export const CRITICAL_DNA_FIELDS = [
  "occupancy_classification",
  "construction_type",
  "county",
  "stories",
  "total_sq_ft",
  "fbc_edition",
] as const;

const FIELD_LABELS: Record<string, string> = {
  occupancy_classification: "Occupancy Classification",
  construction_type: "Construction Type",
  county: "County",
  stories: "Stories",
  total_sq_ft: "Total Sq Ft",
  fbc_edition: "FBC Edition",
};

interface Props {
  planReviewId: string;
  projectCounty: string | null;
  onJumpToDna: () => void;
}

interface DnaExtractMeta {
  completeness?: number;
  critical_missing?: string[];
  jurisdiction_mismatch?: boolean;
  blocking?: boolean;
  block_reason?: string | null;
}

export default function DnaHealthBanner({
  planReviewId,
  projectCounty,
  onJumpToDna,
}: Props) {
  const { data: dna } = useProjectDna(planReviewId);
  const { data: pipeRows = [] } = usePipelineStatus(planReviewId);

  const extractRow = useMemo(
    () => pipeRows.find((r) => r.stage === "dna_extract"),
    [pipeRows],
  );
  const extractMeta = useMemo<DnaExtractMeta>(
    () =>
      ((extractRow as unknown as { metadata?: DnaExtractMeta } | undefined)
        ?.metadata ?? {}) as DnaExtractMeta,
    [extractRow],
  );

  // Derive client-side as a fallback when the edge function metadata is stale.
  const { criticalMissing, ambiguous, jurisdictionMismatch, completeness } =
    useMemo(() => {
      if (!dna) {
        return {
          criticalMissing: [] as string[],
          ambiguous: [] as string[],
          jurisdictionMismatch: false,
          completeness: 0,
        };
      }
      const cm: string[] = [];
      for (const f of CRITICAL_DNA_FIELDS) {
        const v = (dna as unknown as Record<string, unknown>)[f];
        if (v === null || v === undefined || v === "") cm.push(f);
      }
      const dnaC = dna.county?.toLowerCase().trim();
      const projC = projectCounty?.toLowerCase().trim();
      const mismatch = !!dnaC && !!projC && dnaC !== projC;
      return {
        criticalMissing: cm,
        ambiguous: dna.ambiguous_fields ?? [],
        jurisdictionMismatch: mismatch,
        completeness: (CRITICAL_DNA_FIELDS.length - cm.length) / CRITICAL_DNA_FIELDS.length,
      };
    }, [dna, projectCounty]);

  // Don't render anything if extraction hasn't run yet — the pipeline stepper handles that case.
  if (!dna && !extractRow) return null;
  if (!dna) return null;

  // Hard block: county missing OR jurisdiction mismatch OR <50% complete OR
  // the edge function explicitly flagged it.
  const isBlocked =
    extractMeta.blocking === true ||
    criticalMissing.includes("county") ||
    jurisdictionMismatch ||
    completeness < 0.5;

  // Soft warning: any critical fields missing or any ambiguous fields.
  const hasWarnings = criticalMissing.length > 0 || ambiguous.length > 0;

  if (!isBlocked && !hasWarnings) return null;

  const tone = isBlocked ? "danger" : "warn";

  const reason = isBlocked
    ? extractMeta.block_reason ??
      (jurisdictionMismatch
        ? `Extracted county "${dna.county}" does not match project county "${projectCounty}". Wrong code edition would be applied to every finding.`
        : criticalMissing.includes("county")
          ? "County is missing from extracted DNA — cannot apply jurisdiction-specific code."
          : `Only ${Math.round(completeness * 100)}% of critical DNA fields populated — findings would be unreliable.`)
    : `${criticalMissing.length + ambiguous.length} critical field${
        criticalMissing.length + ambiguous.length === 1 ? "" : "s"
      } missing or ambiguous. Findings may be incomplete.`;

  const allFields = [
    ...criticalMissing.map((f) => ({ key: f, kind: "missing" as const })),
    ...ambiguous
      .filter((f) => !criticalMissing.includes(f))
      .map((f) => ({ key: f, kind: "ambiguous" as const })),
  ];

  return (
    <div
      role="alert"
      className={cn(
        "rounded-lg border-2 p-4 shadow-sm",
        tone === "danger"
          ? "border-destructive bg-destructive/5"
          : "border-amber-500/60 bg-amber-500/5 dark:border-amber-400/50",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
            tone === "danger"
              ? "bg-destructive/15 text-destructive"
              : "bg-amber-500/15 text-amber-700 dark:text-amber-400",
          )}
        >
          {tone === "danger" ? (
            <ShieldOff className="h-4 w-4" />
          ) : (
            <AlertTriangle className="h-4 w-4" />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <div
              className={cn(
                "text-sm font-semibold",
                tone === "danger"
                  ? "text-destructive"
                  : "text-amber-800 dark:text-amber-300",
              )}
            >
              {tone === "danger"
                ? "Project DNA extraction incomplete — findings paused"
                : "Project DNA partially extracted — review before trusting findings"}
            </div>
            <div className="mt-1 text-xs text-foreground/80">{reason}</div>
          </div>

          {allFields.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {allFields.map(({ key, kind }) => (
                <span
                  key={key}
                  className={cn(
                    "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-2xs font-medium",
                    kind === "missing"
                      ? "border-destructive/40 bg-destructive/10 text-destructive"
                      : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
                  )}
                >
                  <span className="font-mono uppercase tracking-wide text-2xs opacity-70">
                    {kind === "missing" ? "MISSING" : "AMBIG"}
                  </span>
                  {FIELD_LABELS[key] ?? key}
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              variant={tone === "danger" ? "destructive" : "secondary"}
              onClick={onJumpToDna}
              className="h-7 text-xs"
            >
              Fix in Project DNA
              <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
            {tone === "danger" && (
              <span className="text-2xs text-muted-foreground">
                Downstream stages will not run until resolved.
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
