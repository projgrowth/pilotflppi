import { useState, useRef, useEffect, useCallback } from "react";
import { streamAI } from "@/lib/ai";
import { getCountyRequirements } from "@/lib/county-requirements";
import { COUNTY_REGISTRY } from "@/lib/county-requirements/data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Send, Loader2, Sparkles, MapPin, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const COUNTY_OPTIONS = Object.entries(COUNTY_REGISTRY)
  .map(([key, val]) => ({ key, label: (val as Record<string, unknown>).label as string || key }))
  .sort((a, b) => a.label.localeCompare(b.label));

const QUICK_QUESTIONS = [
  "What are the wind load requirements?",
  "What product approvals are accepted?",
  "What are the Private Provider filing requirements?",
  "What flood zone requirements apply?",
];

export default function FbcCountyChatbot() {
  const [county, setCounty] = useState("miami-dade");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const countyReqs = getCountyRequirements(county);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || streaming) return;

    const userMsg: Message = { role: "user", content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setStreaming(true);

    let assistantContent = "";

    const countyContext = {
      county: countyReqs.label,
      hvhz: countyReqs.hvhz,
      cccl: countyReqs.cccl,
      designWindSpeed: countyReqs.designWindSpeed,
      productApprovalFormat: countyReqs.productApprovalFormat,
      windBorneDebrisRegion: countyReqs.windBorneDebrisRegion,
      floodZoneRequired: countyReqs.floodZoneRequired,
      energyCodePath: countyReqs.energyCodePath,
      amendments: countyReqs.amendments,
      submissionNotes: countyReqs.submissionNotes,
      buildingDepartment: countyReqs.buildingDepartment,
    };

    // Build conversation history for context
    const allMessages = [...messages, userMsg];
    const historyForAI = allMessages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    try {
      await streamAI({
        action: "fbc_county_chat",
        payload: {
          county_context: countyContext,
          conversation: historyForAI,
          question: text,
        },
        onDelta: (chunk) => {
          assistantContent += chunk;
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantContent } : m);
            }
            return [...prev, { role: "assistant", content: assistantContent }];
          });
        },
        onDone: () => setStreaming(false),
      });
    } catch (err) {
      setStreaming(false);
      toast.error(err instanceof Error ? err.message : "Failed to get response");
    }
  }, [streaming, messages, countyReqs]);

  return (
    <Card className="shadow-subtle border flex flex-col h-[600px]">
      <CardHeader className="pb-3 space-y-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-accent" />
            FBC County Chatbot
          </CardTitle>
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => setMessages([])}>
              <Trash2 className="h-3 w-3 mr-1" /> Clear
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <Select value={county} onValueChange={(v) => { setCounty(v); setMessages([]); }}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-60">
              {COUNTY_OPTIONS.map(c => (
                <SelectItem key={c.key} value={c.key} className="text-xs">{c.label} County</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {countyReqs.hvhz && <Badge variant="destructive" className="text-[10px] shrink-0">HVHZ</Badge>}
          {countyReqs.cccl && <Badge variant="outline" className="text-[10px] shrink-0">CCCL</Badge>}
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col p-0 min-h-0">
        <ScrollArea className="flex-1 px-4" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="py-6 space-y-3">
              <p className="text-xs text-muted-foreground text-center">
                Ask about FBC 2023 requirements for <strong>{countyReqs.label} County</strong>
              </p>
              <p className="text-[10px] text-muted-foreground text-center">
                Wind: {countyReqs.designWindSpeed} · Approval: {countyReqs.productApprovalFormat}
              </p>
              <div className="grid grid-cols-2 gap-2 mt-4">
                {QUICK_QUESTIONS.map(q => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    className="text-left text-[11px] p-2 rounded-md border bg-muted/30 hover:bg-muted/60 transition-colors text-foreground"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="py-3 space-y-3">
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/50 border"
                  }`}>
                    {msg.role === "assistant" ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none [&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1 [&>h1]:text-sm [&>h2]:text-sm [&>h3]:text-xs whitespace-pre-wrap">
                        {msg.content}
                        {streaming && i === messages.length - 1 && (
                          <span className="inline-block w-1.5 h-3.5 bg-accent animate-pulse ml-0.5" />
                        )}
                      </div>
                    ) : (
                      <span>{msg.content}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        <div className="p-3 border-t flex gap-2">
          <Input
            placeholder={`Ask about ${countyReqs.label} County FBC requirements…`}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && sendMessage(input)}
            disabled={streaming}
            className="text-sm h-9"
          />
          <Button
            size="icon"
            onClick={() => sendMessage(input)}
            disabled={streaming || !input.trim()}
            className="bg-accent text-accent-foreground hover:bg-accent/90 shrink-0 h-9 w-9"
          >
            {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
