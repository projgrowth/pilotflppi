import { Card, CardContent } from "@/components/ui/card";
import { DeadlineBar } from "@/components/DeadlineBar";
import { Badge } from "@/components/ui/badge";
import { Gavel, Pause, Play } from "lucide-react";
import { getStatutoryStatus, type StatutoryStatus } from "@/lib/statutory-deadlines";
import { cn } from "@/lib/utils";

interface StatutoryClockCardProps {
  project: {
    status: string;
    review_clock_started_at?: string | null;
    review_clock_paused_at?: string | null;
    statutory_review_days?: number | null;
    statutory_inspection_days?: number | null;
    notice_filed_at?: string | null;
  };
}

export function StatutoryClockCard({ project }: StatutoryClockCardProps) {
  const stat = getStatutoryStatus(project);

  if (stat.phase === "none" || stat.phase === "complete") return null;

  return (
    <Card className="shadow-subtle border">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <Gavel className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              F.S. 553.791 Clock
            </h3>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] gap-1",
              stat.clockRunning ? "text-success border-success/30" : "text-warning border-warning/30"
            )}
          >
            {stat.clockRunning ? <Play className="h-2.5 w-2.5" /> : <Pause className="h-2.5 w-2.5" />}
            {stat.clockRunning ? "Running" : "Paused"}
          </Badge>
        </div>

        {stat.phase === "review" && (
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

        {stat.isOverdue && (
          <p className="mt-2 text-[10px] text-destructive font-semibold animate-pulse">
            ⚠ Statutory deadline exceeded — potential F.S. 553.791 violation
          </p>
        )}
      </CardContent>
    </Card>
  );
}
