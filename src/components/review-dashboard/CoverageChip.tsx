/**
 * CoverageChip — surfaces the *truth* about how many sheets the AI actually
 * reviewed for this plan review.
 *
 * Reads from `public.review_coverage` (one row per plan_review_id, written by
 * the discipline_review stage). When no row exists yet — e.g. pipeline hasn't
 * run, or this is a pre-coverage-tracking review — falls back to
 * `sheet_coverage` totals so the chip always has something to show.
 *
 * Tones:
 *   - "ok"   : every sheet covered
 *   - "warn" : some discipline hit MAX_SHEETS_PER_DISCIPLINE (capped) or no
 *              row written yet but sheets exist
 *   - "muted": nothing reviewed yet
 */
import { useMemo } from "react";
import { ChevronDown, Layers } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useSheetCoverage } from "@/hooks/useReviewDashboard";

interface ByDiscipline {
  [discipline: string]: { reviewed: number; total: number };
}

interface CoverageRow {
  plan_review_id: string;
  sheets_total: number;
  sheets_reviewed: number;
  by_discipline: ByDiscipline;
  capped_at: number | null;
}

function useReviewCoverage(planReviewId?: string) {
  return useQuery({
    queryKey: ["review_coverage", planReviewId],
    enabled: !!planReviewId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("review_coverage" as never)
        .select("plan_review_id, sheets_total, sheets_reviewed, by_discipline, capped_at")
        .eq("plan_review_id", planReviewId!)
        .maybeSingle();
      if (error && error.code !== "PGRST116") throw error;
      return (data ?? null) as CoverageRow | null;
    },
  });
}

interface Props {
  planReviewId: string;
}

export default function CoverageChip({ planReviewId }: Props) {
  const { data: coverage } = useReviewCoverage(planReviewId);
  const { data: sheets = [] } = useSheetCoverage(planReviewId);

  const fallback = useMemo(() => {
    const total = sheets.length;
    const reviewed = coverage?.sheets_reviewed ?? 0;
    return { total, reviewed };
  }, [sheets, coverage]);

  const total = coverage?.sheets_total ?? fallback.total;
  const reviewed = coverage?.sheets_reviewed ?? fallback.reviewed;
  const capped = (coverage?.capped_at ?? 0) > 0;

  const tone: "ok" | "warn" | "muted" =
    total === 0
      ? "muted"
      : capped || reviewed < total
        ? "warn"
        : "ok";

  const toneCls =
    tone === "ok"
      ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10"
      : tone === "warn"
        ? "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
        : "border-border bg-muted/40 text-muted-foreground hover:bg-muted/70";

  const value = total > 0 ? `${reviewed}/${total} sheets` : "No sheets yet";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
            toneCls,
          )}
        >
          <Layers className="h-3 w-3" />
          <span className="font-medium">Coverage</span>
          <span className="font-mono text-foreground">{value}</span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[420px] p-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between border-b pb-1.5">
            <div className="text-xs font-semibold">AI review coverage</div>
            <div className="font-mono text-2xs text-muted-foreground">
              {reviewed} / {total} sheets
            </div>
          </div>
          <p className="text-2xs text-muted-foreground leading-snug">
            How many sheets the AI actually examined per discipline. A capped row
            means the discipline hit the per-run safety ceiling — re-run the
            pipeline if you need additional pages reviewed.
          </p>
          {coverage?.by_discipline && Object.keys(coverage.by_discipline).length > 0 ? (
            <ul className="space-y-1">
              {Object.entries(coverage.by_discipline)
                .sort((a, b) => (b[1].total ?? 0) - (a[1].total ?? 0))
                .map(([disc, row]) => {
                  const pct =
                    row.total > 0 ? Math.round((row.reviewed / row.total) * 100) : 0;
                  return (
                    <li
                      key={disc}
                      className="flex items-center justify-between rounded border border-border/60 bg-muted/30 px-2 py-1 text-2xs"
                    >
                      <span className="font-medium">{disc}</span>
                      <span className="font-mono text-muted-foreground">
                        {row.reviewed}/{row.total} ({pct}%)
                      </span>
                    </li>
                  );
                })}
            </ul>
          ) : (
            <div className="py-3 text-center text-2xs text-muted-foreground">
              No discipline coverage recorded yet — re-run the pipeline.
            </div>
          )}
          {capped && (
            <div className="rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-2xs text-amber-700 dark:text-amber-400">
              One or more disciplines hit the per-run cap of{" "}
              <span className="font-mono">{coverage?.capped_at}</span> sheets.
              Re-run the pipeline to review additional pages.
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
