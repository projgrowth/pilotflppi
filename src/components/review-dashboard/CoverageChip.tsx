/**
 * Per-discipline AI sheet coverage chip.
 *
 * Reads `review_coverage` (written at the end of stageDisciplineReview).
 * Shows total reviewed/total sheets in the trigger; the popover lists each
 * discipline's coverage so reviewers know exactly which disciplines were
 * fully covered by the AI vs. still needing manual eyes.
 */
import { useQuery } from "@tanstack/react-query";
import { Layers, ChevronDown } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface DisciplineCoverage {
  reviewed: number;
  total: number;
}

interface ReviewCoverageRow {
  plan_review_id: string;
  sheets_total: number;
  sheets_reviewed: number;
  by_discipline: Record<string, DisciplineCoverage>;
  capped_at: number | null;
}

export default function CoverageChip({ planReviewId }: { planReviewId: string }) {
  const { data } = useQuery({
    queryKey: ["review_coverage", planReviewId],
    enabled: !!planReviewId,
    queryFn: async (): Promise<ReviewCoverageRow | null> => {
      // review_coverage isn't in the auto-generated client types yet because
      // it was just added — fall back to an untyped raw call.
      const client = supabase as unknown as {
        from: (t: string) => {
          select: (cols: string) => {
            eq: (col: string, val: string) => {
              maybeSingle: () => Promise<{ data: ReviewCoverageRow | null; error: unknown }>;
            };
          };
        };
      };
      const { data, error } = await client
        .from("review_coverage")
        .select("plan_review_id, sheets_total, sheets_reviewed, by_discipline, capped_at")
        .eq("plan_review_id", planReviewId)
        .maybeSingle();
      if (error) return null;
      return data;
    },
  });

  if (!data || data.sheets_total === 0) return null;

  const fullyCovered = data.sheets_reviewed >= data.sheets_total;
  const tone = fullyCovered ? "ok" : "warn";

  const toneCls =
    tone === "ok"
      ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10"
      : "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10";

  const entries = Object.entries(data.by_discipline ?? {}) as Array<[string, DisciplineCoverage]>;
  entries.sort((a, b) => (b[1].total ?? 0) - (a[1].total ?? 0));

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
          <span className="font-mono text-foreground">
            {data.sheets_reviewed}/{data.sheets_total}
          </span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[360px] p-2">
        <div className="space-y-2">
          <div className="border-b pb-1.5">
            <div className="text-xs font-semibold">AI sheet coverage</div>
            <div className="font-mono text-2xs text-muted-foreground">
              {data.sheets_reviewed}/{data.sheets_total} sheets reviewed
              {data.capped_at ? ` · capped at ${data.capped_at}/discipline` : ""}
            </div>
          </div>
          {entries.length === 0 ? (
            <div className="py-3 text-center text-2xs text-muted-foreground">
              No discipline breakdown yet.
            </div>
          ) : (
            <ul className="space-y-1">
              {entries.map(([disc, cov]) => {
                const full = cov.reviewed >= cov.total && cov.total > 0;
                return (
                  <li
                    key={disc}
                    className="flex items-center justify-between rounded border border-border/50 bg-muted/20 px-2 py-1"
                  >
                    <span className="text-2xs font-medium">{disc}</span>
                    <span
                      className={cn(
                        "font-mono text-2xs",
                        full ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400",
                      )}
                    >
                      {cov.reviewed}/{cov.total}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {!fullyCovered && (
            <p className="text-2xs text-muted-foreground">
              Disciplines under 100% need manual eyes on the remaining sheets.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
