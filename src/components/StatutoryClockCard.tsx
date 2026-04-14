import { Card, CardContent } from "@/components/ui/card";
import { DeadlineBar } from "@/components/DeadlineBar";
import { Badge } from "@/components/ui/badge";
import { Gavel, Pause, Play, AlertTriangle } from "lucide-react";
import { getStatutoryStatus } from "@/lib/statutory-deadlines";
import { cn } from "@/lib/utils";

interface StatutoryClockCardProps {
  project: {
    status: string;
    review_clock_started_at?: string | null;
    review_clock_paused_at?: string | null;
    inspection_clock_started_at?: string | null;
    statutory_review_days?: number | null;
    statutory_inspection_days?: number | null;
    notice_filed_at?: string | null;
  };
}

export function StatutoryClockCard({ project }: StatutoryClockCardProps) {
  const stat = getStatutoryStatus(project);

  if (stat.phase === "none" || stat.phase === "complete") return null;

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
          <p className="mt-2 text-2xs text-destructive font-semibold animate-pulse">
            ⚠ Per F.S. 553.791(4)(b), plans are DEEMED APPROVED — 30 business days expired without action
          </p>
        )}

        {stat.isOverdue && !stat.isDeemedApproved && (
          <p className="mt-2 text-2xs text-destructive font-semibold animate-pulse">
            ⚠ Statutory deadline exceeded — potential F.S. 553.791 violation
          </p>
        )}
      </CardContent>
    </Card>
  );
}
