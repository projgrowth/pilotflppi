import { useState } from "react";
import { callAI } from "@/lib/ai";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/PageHeader";
import { Sparkles, Send, Loader2, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import FbcCountyChatbot from "@/components/FbcCountyChatbot";

export default function AIBriefing() {
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
    <div className="p-8 md:p-10 max-w-7xl space-y-6">
      <PageHeader
        title="AI Briefing"
        subtitle="AI-powered code research tools"
      />

      {/* County Code Assistant — full width hero */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5" />
          County Code Assistant
        </h2>
        <div className="[&>div]:h-[560px] [&>div]:border-accent/20">
          <FbcCountyChatbot />
        </div>
      </div>

      {/* Quick Code Q&A */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5" />
          Quick Code Q&A
        </h2>
        <Card className="shadow-subtle">
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
  );
}
