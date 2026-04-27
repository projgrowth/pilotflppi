/**
 * LetterSnapshotViewer — read-only viewer for past sent letters. Lists every
 * snapshot for a plan_review (newest first), opens a dialog with the frozen
 * HTML and a frozen findings table. This is the "what did Round 1 look like
 * when I sent it on Apr 12" answer.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FileText, ExternalLink, Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import DOMPurify from "dompurify";

interface SnapshotRow {
  id: string;
  sent_at: string;
  round: number;
  recipient: string;
  letter_html: string;
  override_reasons: string | null;
  findings_json: unknown;
  readiness_snapshot: { blocking_count?: number } | null;
}

interface Props {
  planReviewId: string;
}

export default function LetterSnapshotViewer({ planReviewId }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: snapshots = [], isLoading } = useQuery({
    queryKey: ["letter_snapshots", planReviewId],
    enabled: !!planReviewId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("comment_letter_snapshots")
        .select(
          "id, sent_at, round, recipient, letter_html, override_reasons, findings_json, readiness_snapshot",
        )
        .eq("plan_review_id", planReviewId)
        .order("sent_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as SnapshotRow[];
    },
  });

  const open = openId ? snapshots.find((s) => s.id === openId) : null;
  const sanitizedHtml = open
    ? DOMPurify.sanitize(open.letter_html, {
        ADD_TAGS: ["style"],
        ADD_ATTR: ["style", "class"],
      })
    : "";

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading sent letters…
      </div>
    );
  }

  if (snapshots.length === 0) {
    return (
      <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
        No comment letters have been sent yet for this review.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Sent letter history
      </div>
      <ul className="space-y-1.5">
        {snapshots.map((s) => {
          const findings = Array.isArray(s.findings_json)
            ? s.findings_json.length
            : 0;
          const sent = new Date(s.sent_at);
          return (
            <li
              key={s.id}
              className="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2 text-xs"
            >
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="font-medium">
                    Round {s.round} ·{" "}
                    {sent.toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </div>
                  <div className="truncate text-2xs text-muted-foreground">
                    {findings} finding{findings === 1 ? "" : "s"}
                    {s.recipient ? ` · to ${s.recipient}` : ""}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {s.override_reasons && (
                  <Badge variant="outline" className="gap-1 text-2xs">
                    <ShieldAlert className="h-3 w-3 text-warning" />
                    Override
                  </Badge>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 text-2xs"
                  onClick={() => setOpenId(s.id)}
                >
                  View
                  <ExternalLink className="h-3 w-3" />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <Dialog open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-hidden p-0">
          <DialogHeader className="border-b bg-muted/30 px-4 py-3">
            <DialogTitle>
              Sent letter — Round {open?.round}
            </DialogTitle>
            <DialogDescription>
              Frozen on{" "}
              {open
                ? new Date(open.sent_at).toLocaleString()
                : ""}{" "}
              · this snapshot is immutable
              {open?.override_reasons
                ? ` · override reason: "${open.override_reasons}"`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto bg-white p-4">
            {open && (
              <div
                className="prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
