import { useState } from "react";
import { useActivityLog, getEventColor } from "@/hooks/useActivityLog";
import { callAI } from "@/lib/ai";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sparkles, Send, Loader2, MessageSquare } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import FbcCountyChatbot from "@/components/FbcCountyChatbot";

export default function AIBriefing() {
  const { data: activity, isLoading } = useActivityLog(20);
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
    <div className="p-6 md:p-8 max-w-7xl">
      <h1 className="text-2xl font-medium mb-6">AI Briefing</h1>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Activity feed */}
        <div className="lg:col-span-3 space-y-6">
          <div>
            <h2 className="mb-4 text-sm font-semibold text-muted-foreground uppercase tracking-wide">Activity Feed</h2>
            <Card className="shadow-subtle border">
              <CardContent className="p-0 divide-y">
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="flex items-start gap-3 px-5 py-3">
                      <div className="mt-1.5 h-2 w-2 rounded-full bg-muted animate-pulse" />
                      <div className="flex-1 space-y-1">
                        <div className="h-4 w-full rounded bg-muted animate-pulse" />
                        <div className="h-3 w-20 rounded bg-muted animate-pulse" />
                      </div>
                    </div>
                  ))
                ) : (activity || []).length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">No activity yet</div>
                ) : (
                  (activity || []).map((item) => (
                    <div key={item.id} className="flex items-start gap-3 px-5 py-3">
                      <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${getEventColor(item.event_type)}`} />
                      <div className="flex-1">
                        <p className="text-sm">{item.description}</p>
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

          {/* Quick Code Q&A */}
          <div>
            <h2 className="mb-4 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              <MessageSquare className="h-3.5 w-3.5 inline mr-1" />
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
        </div>

        {/* FBC County Chatbot */}
        <div className="lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            <Sparkles className="h-3.5 w-3.5 inline mr-1" />
            County Code Assistant
          </h2>
          <FbcCountyChatbot />
        </div>
      </div>
    </div>
  );
}
