import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, ShieldCheck, ShieldX, ShieldAlert, GitMerge, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  type DeficiencyV2Row,
  useSheetCoverage,
} from "@/hooks/useReviewDashboard";
import CitationBadge from "../CitationBadge";
import { useRegroundCitation } from "@/hooks/useRegroundCitation";

interface Props {
  planReviewId: string;
  def: DeficiencyV2Row;
}

export default function DeficiencyHeader({ planReviewId, def }: Props) {
  const { data: coverage = [] } = useSheetCoverage(planReviewId);
  const params = useParams();
  // If reviewer is already inside the plan-review workspace for this review,
  // re-use the same tab; otherwise pop a new one to keep the dashboard alive.
  const sameTab = params.id === planReviewId;

  const pageJump = useMemo(() => {
    const firstSheet = (def.sheet_refs ?? [])[0]?.toUpperCase();
    if (!firstSheet) return null;
    const hit = coverage.find(
      (c) => c.sheet_ref.toUpperCase() === firstSheet && c.page_index !== null,
    );
    return hit
      ? { sheet: firstSheet, page: hit.page_index! }
      : { sheet: firstSheet, page: null };
  }, [coverage, def.sheet_refs]);

  // Tier 4: surface cross-discipline conflict link on the SOURCE finding.
  // The XD conflict row stores both source IDs in evidence_crop_meta. We
  // scan the cached deficiency list and look for any DEF-XD* row that
  // names this finding's id in its conflict_with array.
  const qc = useQueryClient();
  const conflictLink = useMemo(() => {
    const all =
      qc.getQueryData<DeficiencyV2Row[]>(["deficiencies_v2", planReviewId]) ??
      [];
    for (const row of all) {
      if (!row.def_number?.startsWith("DEF-XD")) continue;
      const meta = (row.evidence_crop_meta ?? {}) as {
        cross_discipline_conflict_with?: string[];
      };
      const linked = meta.cross_discipline_conflict_with ?? [];
      if (linked.includes(def.id)) {
        const otherId = linked.find((id) => id !== def.id) ?? null;
        const otherDef = otherId
          ? all.find((d) => d.id === otherId) ?? null
          : null;
        return { conflictRow: row, otherDef };
      }
    }
    return null;
  }, [qc, planReviewId, def.id]);

  const codeRef = def.code_reference;
  const codeRefStr = codeRef
    ? [codeRef.code, codeRef.section, codeRef.edition && `(${codeRef.edition})`]
        .filter(Boolean)
        .join(" ")
    : null;

  return (
    <>
      {/* Top row: number, discipline, conf, badges */}
      <div className="flex flex-wrap items-center gap-2 text-2xs">
        <span
          className={cn(
            "rounded-md border px-2 py-0.5 font-mono font-semibold",
            priorityCls(def.priority),
          )}
        >
          {def.def_number}
        </span>
        <span className="text-muted-foreground">{def.discipline}</span>
        {typeof def.confidence_score === "number" && (
          <span className="font-mono text-muted-foreground">
            · conf {def.confidence_score.toFixed(2)}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <VerificationBadge status={def.verification_status} notes={def.verification_notes} />
          {def.life_safety_flag && <Tag tone="critical">LIFE SAFETY</Tag>}
          {def.permit_blocker && <Tag tone="warn">PERMIT BLOCKER</Tag>}
          {def.liability_flag && <Tag tone="caution">LIABILITY</Tag>}
          {def.requires_human_review && <Tag tone="accent">NEEDS HUMAN EYES</Tag>}
          {conflictLink && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="inline-flex cursor-help items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400"
                  aria-label={`Cross-discipline conflict with ${conflictLink.otherDef?.def_number ?? "another finding"}`}
                >
                  <GitMerge className="h-3 w-3" />
                  XD CONFLICT
                  {conflictLink.otherDef?.def_number && (
                    <span className="font-mono opacity-80">
                      ↔ {conflictLink.otherDef.def_number}
                    </span>
                  )}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs space-y-1 text-xs">
                <div className="font-semibold">Cross-discipline conflict</div>
                <div className="opacity-90">
                  This finding is contradicted by{" "}
                  <span className="font-mono">
                    {conflictLink.otherDef?.def_number ?? "another finding"}
                  </span>
                  {conflictLink.otherDef?.discipline && (
                    <> ({conflictLink.otherDef.discipline})</>
                  )}
                  . See{" "}
                  <span className="font-mono">
                    {conflictLink.conflictRow.def_number}
                  </span>{" "}
                  to reconcile.
                </div>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="mt-3 space-y-2">
        {codeRefStr && (
          <div className="text-2xs font-mono text-muted-foreground">{codeRefStr}</div>
        )}
        <div>
          <div className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
            Finding
          </div>
          <div className="text-sm">{def.finding}</div>
        </div>
        <div>
          <div className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
            Required Action
          </div>
          <div className="text-sm">{def.required_action}</div>
        </div>

        {def.sheet_refs.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
              Sheets:
            </span>
            {def.sheet_refs.map((s) => (
              <Badge key={s} variant="secondary" className="font-mono text-2xs">
                {s}
              </Badge>
            ))}
            {pageJump && (
              <Button
                asChild
                size="sm"
                variant="outline"
                className="ml-1 h-6 gap-1 px-2 text-2xs"
              >
                <Link
                  to={
                    pageJump.page !== null
                      ? `/plan-review/${planReviewId}?page=${pageJump.page}`
                      : `/plan-review/${planReviewId}`
                  }
                  target={sameTab ? undefined : "_blank"}
                  rel={sameTab ? undefined : "noopener noreferrer"}
                >
                  <ExternalLink className="h-3 w-3" />
                  Open {pageJump.sheet}
                </Link>
              </Button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function VerificationBadge({
  status,
  notes,
}: {
  status: DeficiencyV2Row["verification_status"];
  notes: string | null;
}) {
  if (status === "unverified") return null;
  const cfg =
    status === "verified"
      ? {
          icon: <ShieldCheck className="h-3 w-3" />,
          label: "VERIFIED",
          cls: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400",
        }
      : status === "overturned"
        ? {
            icon: <ShieldX className="h-3 w-3" />,
            label: "OVERTURNED",
            cls: "bg-destructive/10 text-destructive border-destructive/30",
          }
        : {
            icon: <ShieldAlert className="h-3 w-3" />,
            label: "MODIFIED",
            cls: "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400",
          };
  const badge = (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        cfg.cls,
      )}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
  if (!notes) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{notes}</TooltipContent>
    </Tooltip>
  );
}

function priorityCls(p: "high" | "medium" | "low") {
  if (p === "high") return "bg-destructive/10 text-destructive border-destructive/30";
  if (p === "medium") return "bg-orange-500/10 text-orange-600 border-orange-500/30 dark:text-orange-400";
  return "bg-muted text-muted-foreground border-border";
}

function Tag({
  tone,
  children,
}: {
  tone: "critical" | "warn" | "caution" | "accent";
  children: React.ReactNode;
}) {
  const cls =
    tone === "critical"
      ? "bg-destructive text-destructive-foreground"
      : tone === "warn"
        ? "bg-orange-500 text-white"
        : tone === "caution"
          ? "bg-amber-500 text-white"
          : "bg-accent text-accent-foreground";
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${cls}`}
    >
      {children}
    </span>
  );
}
