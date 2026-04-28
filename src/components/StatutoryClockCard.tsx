import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { DeadlineBar } from "@/components/DeadlineBar";
import { Badge } from "@/components/ui/badge";
import { Gavel, Pause, Play, AlertTriangle, History } from "lucide-react";
import { getStatutoryStatus } from "@/lib/statutory-deadlines";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface StatutoryClockCardProps {
  project: {
    id?: string;
    status: string;
    review_clock_started_at?: string | null;
    review_clock_paused_at?: string | null;
    inspection_clock_started_at?: string | null;
    statutory_review_days?: number | null;
    statutory_inspection_days?: number | null;
    notice_filed_at?: string | null;
  };
}

interface ClockHistoryEvent {
  id: string;
  event_type: string;
  description: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

const CLOCK_EVENT_TYPES = [
  "statutory_clock_reset",
  "statutory_clock_paused",
  "statutory_clock_resumed",
  "deadline_overdue",
];

function useClockHistory(projectId: string | undefined) {
  return useQuery<ClockHistoryEvent[]>({
    queryKey: ["statutory_clock_history", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_log")
        .select("id, event_type, description, created_at, metadata")
        .eq("project_id", projectId!)
        .in("event_type", CLOCK_EVENT_TYPES)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as ClockHistoryEvent[];
    },
  });
}

export function StatutoryClockCard({ project }: StatutoryClockCardProps) {
  const stat = getStatutoryStatus(project);
  const { data: history } = useClockHistory(project.id);

  if (stat.phase === "none" || stat.phase === "complete") return null;

  const events = history ?? [];
  const hasHistory = events.length > 0;

  return (
    <Card className={cn("shadow-subtle border", stat.isDeemedApproved && "border-destructive/50 bg-destructive/5")}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <Gavel className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              F.S. 553.791 Clock
            </h3>
          </div>
          {stat.isDeemedApproved ? (
            <Badge variant="destructive" className="text-2xs gap-1">
              <AlertTriangle className="h-2.5 w-2.5" /> DEEMED APPROVED
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className={cn(
                "text-2xs gap-1",
                stat.clockRunning ? "text-success border-success/30" : "text-warning border-warning/30"
              )}
            >
              {stat.clockRunning ? <Play className="h-2.5 w-2.5" /> : <Pause className="h-2.5 w-2.5" />}
              {stat.clockRunning ? "Running" : "Paused"}
            </Badge>
          )}
        </div>

        {(stat.phase === "review" || stat.phase === "deemed_approved") && (
          <DeadlineBar
            daysElapsed={stat.reviewDaysUsed}
            totalDays={stat.reviewDaysTotal}
            statutory
            label="Plan Review (30 biz days)"
          />
        )}

        {stat.phase === "inspection" && (
          <DeadlineBar
            daysElapsed={stat.inspectionDaysUsed}
            totalDays={stat.inspectionDaysTotal}
            statutory
            label="Inspection (10 biz days)"
          />
        )}

        {stat.isDeemedApproved && (
          <p className="mt-2 text-2xs text-destructive font-semibold">
            ⚠ Per F.S. 553.791(4)(b), plans are DEEMED APPROVED — 30 business days expired without action
          </p>
        )}

        {stat.isOverdue && !stat.isDeemedApproved && (
          <p className="mt-2 text-2xs text-destructive font-semibold">
            ⚠ Statutory deadline exceeded — potential F.S. 553.791 violation
          </p>
        )}

        {hasHistory && (
          <Collapsible className="mt-3 border-t pt-2">
            <CollapsibleTrigger className="flex w-full items-center justify-between text-2xs text-muted-foreground hover:text-foreground">
              <span className="flex items-center gap-1">
                <History className="h-3 w-3" />
                Clock history ({events.length})
              </span>
              <span className="text-muted-foreground">▾</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 space-y-1.5">
              {events.map((ev) => (
                <div
                  key={ev.id}
                  className="flex items-start gap-2 rounded-md border bg-card/50 p-2"
                >
                  <ClockEventIcon eventType={ev.event_type} />
                  <div className="min-w-0 flex-1">
                    <div className="text-2xs font-medium leading-tight">
                      {ev.description}
                    </div>
                    <div className="text-2xs text-muted-foreground">
                      {new Date(ev.created_at).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}

function ClockEventIcon({ eventType }: { eventType: string }) {
  if (eventType === "statutory_clock_paused") {
    return <Pause className="mt-0.5 h-3 w-3 flex-shrink-0 text-warning" />;
  }
  if (eventType === "statutory_clock_resumed" || eventType === "statutory_clock_reset") {
    return <Play className="mt-0.5 h-3 w-3 flex-shrink-0 text-success" />;
  }
  if (eventType === "deadline_overdue") {
    return <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0 text-destructive" />;
  }
  return <Gavel className="mt-0.5 h-3 w-3 flex-shrink-0 text-muted-foreground" />;
}

