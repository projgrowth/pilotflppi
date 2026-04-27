import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Progress } from "@/components/ui/progress";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

interface Props {
  planReviewId: string;
}

interface ProgressShape {
  pre_rasterized_pages?: number;
  total_pages?: number;
  client_raster_aborted?: boolean;
}

/**
 * Live "Preparing pages X / N" strip shown on the wizard's Step 3 panel.
 * Subscribes to plan_reviews.ai_run_progress so the user sees real movement
 * during the (potentially slow) browser-side PDF rasterization step instead
 * of staring at a frozen "Creating…" button.
 */
export function PagePrepProgress({ planReviewId }: Props) {
  const [data, setData] = useState<ProgressShape | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const { data: row } = await supabase
        .from("plan_reviews")
        .select("ai_run_progress")
        .eq("id", planReviewId)
        .maybeSingle();
      if (!cancelled && row) setData((row.ai_run_progress as ProgressShape) ?? {});
    };

    load();

    // Poll every 1.2s — cheap, no realtime subscription needed for a step
    // that finishes within a few minutes at most.
    const interval = window.setInterval(load, 1200);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [planReviewId]);

  const total = data?.total_pages ?? 0;
  const done = data?.pre_rasterized_pages ?? 0;
  const aborted = !!data?.client_raster_aborted;

  if (!total) return null;

  const pct = Math.min(100, Math.round((done / total) * 100));
  const complete = done >= total;

  if (complete && !aborted) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
        <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="text-foreground/80">All {total} pages prepared</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card px-3 py-2.5 space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 font-medium text-foreground/80">
          {aborted ? (
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
          ) : (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
          {aborted ? "Finishing on server" : "Preparing pages"}
        </span>
        <span className="tabular-nums text-muted-foreground">
          {done} / {total}
        </span>
      </div>
      <Progress value={pct} className="h-1.5" />
      {aborted && (
        <p className="text-[11px] text-muted-foreground">
          Browser preparation hit a limit — the server is rendering the rest. Analysis will continue automatically.
        </p>
      )}
    </div>
  );
}
