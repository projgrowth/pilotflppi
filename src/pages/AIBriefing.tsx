import { useState } from "react";
import { useActivityLog, getEventColor } from "@/hooks/useActivityLog";
import { useDashboardStats } from "@/hooks/useDashboardStats";
import { callAI } from "@/lib/ai";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KpiCard } from "@/components/KpiCard";
import { Sparkles, Send, Loader2, MessageSquare, FolderOpen, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import FbcCountyChatbot from "@/components/FbcCountyChatbot";

export default function AIBriefing() {
  const { data: activity, isLoading: activityLoading } = useActivityLog(10);
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);

  const askCodeQuestion = async () => {
    if (!question.trim()) return;
    setAsking(true);
    setAnswer("");
    try {
      const result = await callAI({
        action: "answer_code_question",
        payload: question,
      });
      setAnswer(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to get answer");
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl space-y-6">
      <h1 className="text-2xl font-medium">AI Briefing</h1>

      {/* Statutory alert banner */}
      {stats && stats.statutoryDue > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          <span>
            <strong className="text-destructive">{stats.statutoryDue} project{stats.statutoryDue > 1 ? "s" : ""}</strong>{" "}
            nearing statutory deadline — review required
          </span>
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Active Projects" value={stats?.activeProjects ?? "—"} icon={FolderOpen} accent loading={statsLoading} />
        <KpiCard label="Due This Week" value={stats?.criticalDeadlines ?? "—"} icon={AlertTriangle} destructive={!!stats && stats.criticalDeadlines > 0} loading={statsLoading} />
        <KpiCard label="Statutory Alerts" value={stats?.statutoryDue ?? "—"} icon={Clock} destructive={!!stats && stats.statutoryDue > 0} loading={statsLoading} />
        <KpiCard label="Completed MTD" value={stats?.completedMTD ?? "—"} icon={CheckCircle2} loading={statsLoading} />
      </div>

      {/* County Code Assistant — full width hero */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5" />
          County Code Assistant
        </h2>
        <div className="[&>div]:h-[520px] [&>div]:border-accent/20">
          <FbcCountyChatbot />
        </div>
      </div>

      {/* Two-column bottom: Q&A + Activity */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Quick Code Q&A */}
        <div>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" />
            Quick Code Q&A
          </h2>
          <Card className="shadow-subtle border">
            <CardContent className="p-4 space-y-4">
              <p className="text-xs text-muted-foreground">Quick one-off FBC 2023 questions (no county context)</p>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g., What are the wind load requirements for HVHZ?"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && askCodeQuestion()}
                />
                <Button
                  size="icon"
                  onClick={askCodeQuestion}
                  disabled={asking || !question.trim()}
                  className="bg-accent text-accent-foreground hover:bg-accent/90 shrink-0"
                >
                  {asking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
              {answer && (
                <div className="rounded-lg border bg-muted/30 p-3 text-sm whitespace-pre-wrap max-h-80 overflow-y-auto">
                  <div className="flex items-center gap-1.5 mb-2 text-xs text-accent font-medium">
                    <MessageSquare className="h-3 w-3" /> AI Response
                  </div>
                  {answer}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Activity Feed (compact) */}
        <div>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">Activity Feed</h2>
          <Card className="shadow-subtle border">
            <CardContent className="p-0 divide-y max-h-80 overflow-y-auto">
              {activityLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-start gap-3 px-4 py-2.5">
                    <div className="mt-1.5 h-2 w-2 rounded-full bg-muted animate-pulse" />
                    <div className="flex-1 space-y-1">
                      <div className="h-3.5 w-full rounded bg-muted animate-pulse" />
                      <div className="h-3 w-16 rounded bg-muted animate-pulse" />
                    </div>
                  </div>
                ))
              ) : (activity || []).length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">No activity yet</div>
              ) : (
                (activity || []).map((item) => (
                  <div key={item.id} className="flex items-start gap-3 px-4 py-2.5">
                    <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${getEventColor(item.event_type)}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{item.description}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
