/**
 * SheetRoutingBanner
 *
 * Surfaces deterministic sheet-routing misroutes detected after sheet_map.
 * If the AI labeled a sheet "Architectural" but the sheet number is P-101 or
 * the title says "PLUMBING PLAN", that sheet never reaches the plumbing
 * reviewer — findings get missed silently. The banner lets the reviewer
 * fix the assignment with one click; the change is persisted to
 * sheet_coverage so any subsequent re-run uses the corrected routing.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, RotateCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useSheetCoverage } from "@/hooks/useReviewDashboard";
import {
  auditSheetRouting,
  applySheetReassignment,
  type SheetRow,
} from "@/lib/sheet-routing-audit";

interface Props {
  planReviewId: string;
}

export default function SheetRoutingBanner({ planReviewId }: Props) {
  const { data: sheets = [] } = useSheetCoverage(planReviewId);
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const misrouted = useMemo(() => {
    const rows: SheetRow[] = sheets.map((s) => ({
      id: s.id,
      sheet_ref: s.sheet_ref,
      sheet_title: s.sheet_title,
      discipline: s.discipline,
      page_index: s.page_index ?? null,
    }));
    return auditSheetRouting(rows);
  }, [sheets]);

  if (misrouted.length === 0) return null;

  const handleApply = async (sheetId: string, suggested: string, label: string) => {
    setBusyId(sheetId);
    const result = await applySheetReassignment({
      sheetCoverageId: sheetId,
      newDiscipline: suggested,
    });
    setBusyId(null);
    if (!result.ok) {
      toast.error(result.error ?? "Failed to reassign sheet");
      return;
    }
    toast.success(`${label} reassigned to ${suggested}. Re-run discipline review to pick up the change.`);
    queryClient.invalidateQueries({ queryKey: ["sheet_coverage", planReviewId] });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
            "border-amber-500/40 bg-amber-500/5 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400",
          )}
          title="Sheets that may have been routed to the wrong discipline reviewer"
        >
          <AlertTriangle className="h-3 w-3" />
          <span className="font-medium">Routing</span>
          <span className="font-mono text-foreground">
            {misrouted.length} suspect{misrouted.length === 1 ? "" : "s"}
          </span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[520px] max-h-[480px] overflow-auto p-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between border-b pb-1.5">
            <div className="text-xs font-semibold">Possible sheet misroutes</div>
            <div className="font-mono text-2xs text-muted-foreground">
              {misrouted.length} sheet{misrouted.length === 1 ? "" : "s"}
            </div>
          </div>
          <p className="text-2xs leading-relaxed text-muted-foreground">
            The AI's discipline label disagrees with the sheet number prefix or printed title.
            Misrouted sheets aren't seen by the right discipline reviewer. Apply a fix and
            re-run discipline review to recover any missed findings.
          </p>
          <ul className="space-y-1.5">
            {misrouted.slice(0, 20).map((m) => (
              <li
                key={m.id}
                className="rounded border border-border/60 bg-muted/30 p-2 text-2xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono font-medium text-foreground">
                      {m.sheet_ref}
                      {typeof m.page_index === "number" && (
                        <span className="ml-1 text-muted-foreground">
                          (page {m.page_index + 1})
                        </span>
                      )}
                    </div>
                    {m.sheet_title && (
                      <div className="truncate text-muted-foreground">{m.sheet_title}</div>
                    )}
                    <div className="mt-1 leading-snug">
                      Routed as <strong>{m.current}</strong> → likely{" "}
                      <strong>{m.suggested}</strong>
                      <span className="ml-1 text-muted-foreground">({m.reason})</span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 shrink-0 px-2 text-2xs"
                    disabled={busyId === m.id}
                    onClick={() => handleApply(m.id, m.suggested, m.sheet_ref)}
                  >
                    {busyId === m.id ? (
                      <RotateCw className="h-3 w-3 animate-spin" />
                    ) : (
                      <>Reassign</>
                    )}
                  </Button>
                </div>
              </li>
            ))}
            {misrouted.length > 20 && (
              <li className="text-center text-2xs text-muted-foreground">
                +{misrouted.length - 20} more
              </li>
            )}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}
