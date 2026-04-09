import { useState } from "react";
import { callAI } from "@/lib/ai";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles, Send, Loader2, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import FbcCountyChatbot from "@/components/FbcCountyChatbot";

interface AIDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AIDrawer({ open, onOpenChange }: AIDrawerProps) {
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" />
            AI Assistant
          </SheetTitle>
        </SheetHeader>

        <div className="px-6 pt-4 pb-6">
          <Tabs defaultValue="county">
            <TabsList className="mb-4">
              <TabsTrigger value="county" className="gap-1.5 text-xs">
                <Sparkles className="h-3 w-3" /> County Code
              </TabsTrigger>
              <TabsTrigger value="quick" className="gap-1.5 text-xs">
                <MessageSquare className="h-3 w-3" /> Quick Q&A
              </TabsTrigger>
            </TabsList>

            <TabsContent value="county">
              <div className="[&>div]:h-[500px] [&>div]:border-accent/20">
                <FbcCountyChatbot />
              </div>
            </TabsContent>

            <TabsContent value="quick" className="space-y-4">
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
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}
