/**
 * Beta-tester feedback dialog. Opens from a button in the sidebar.
 *
 * Captures: a free-text message, severity, category, and an automatic
 * snapshot of the current route + last 20 console errors. If a plan review
 * id is on the URL we attach it; otherwise it stays null.
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { MessageSquareWarning, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const CATEGORIES = [
  { value: "bug", label: "Bug — something is broken" },
  { value: "ai_quality", label: "AI quality — wrong/hallucinated finding" },
  { value: "ux", label: "UX — confusing or hard to use" },
  { value: "performance", label: "Performance — slow or stuck" },
  { value: "data", label: "Data — missing or wrong information" },
  { value: "feature_request", label: "Feature request" },
  { value: "general", label: "General feedback" },
] as const;

const SEVERITIES = [
  { value: "low", label: "Low — minor annoyance" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High — blocks my work" },
  { value: "blocker", label: "Blocker — can't continue" },
] as const;

// Buffer the last 20 console errors so we can attach them automatically.
const errorBuffer: Array<{ at: string; msg: string }> = [];
let errorHookInstalled = false;
function installErrorHook() {
  if (errorHookInstalled || typeof window === "undefined") return;
  errorHookInstalled = true;
  const orig = console.error;
  console.error = (...args: unknown[]) => {
    try {
      const msg = args
        .map((a) => (a instanceof Error ? a.message : String(a)))
        .join(" ")
        .slice(0, 500);
      errorBuffer.push({ at: new Date().toISOString(), msg });
      if (errorBuffer.length > 20) errorBuffer.shift();
    } catch {
      /* swallow */
    }
    orig.apply(console, args as []);
  };
}

export function BetaFeedbackButton({ compact = false }: { compact?: boolean }) {
  const { user } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [severity, setSeverity] = useState<string>("normal");
  const [category, setCategory] = useState<string>("bug");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    installErrorHook();
  }, []);

  const planReviewId = useMemo(() => {
    const m = location.pathname.match(
      /\/plan-review\/([0-9a-f-]{36})/i,
    );
    return m?.[1] ?? null;
  }, [location.pathname]);

  const projectId = useMemo(() => {
    const m = location.pathname.match(/\/project\/([0-9a-f-]{36})/i);
    return m?.[1] ?? null;
  }, [location.pathname]);

  async function submit() {
    if (!user) {
      toast.error("Sign in to send feedback");
      return;
    }
    const trimmed = message.trim();
    if (trimmed.length < 5) {
      toast.error("Add a few words describing what happened");
      return;
    }
    if (trimmed.length > 4000) {
      toast.error("Feedback message is too long (max 4000 chars)");
      return;
    }
    setSubmitting(true);
    try {
      const context = {
        path: location.pathname + location.search,
        viewport:
          typeof window !== "undefined"
            ? `${window.innerWidth}x${window.innerHeight}`
            : null,
        user_agent:
          typeof navigator !== "undefined" ? navigator.userAgent : null,
        recent_errors: errorBuffer.slice(-10),
      };
      const { error } = await supabase.from("beta_feedback").insert({
        user_id: user.id,
        plan_review_id: planReviewId,
        project_id: projectId,
        category,
        severity,
        message: trimmed,
        context,
      });
      if (error) throw error;
      toast.success("Feedback sent — thank you!");
      setMessage("");
      setSeverity("normal");
      setCategory("bug");
      setOpen(false);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to send feedback";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size={compact ? "icon" : "sm"}
          className="gap-2 text-muted-foreground hover:text-foreground"
          aria-label="Send beta feedback"
        >
          <MessageSquareWarning className="h-4 w-4" />
          {!compact && <span>Report a problem</span>}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Report a problem</DialogTitle>
          <DialogDescription>
            We'll attach your current page and recent errors automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Severity</Label>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEVERITIES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">What happened?</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe what you were trying to do and what went wrong..."
              rows={5}
              maxLength={4000}
              className="resize-none"
            />
            <div className="mt-1 text-2xs text-muted-foreground">
              {message.length}/4000
              {planReviewId && " · attaching plan review"}
              {projectId && " · attaching project"}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting} className="gap-1.5">
            <Send className="h-3.5 w-3.5" />
            {submitting ? "Sending…" : "Send feedback"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
