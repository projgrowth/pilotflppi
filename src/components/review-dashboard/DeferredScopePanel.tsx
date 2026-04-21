import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, X, Loader2, FileWarning, ChevronDown, FileText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DEFERRED_SCOPE_LABELS,
  useDeferredScope,
  updateDeferredScopeItem,
  type DeferredScopeItem,
} from "@/hooks/useReviewDashboard";

interface Props {
  planReviewId: string;
}

const STATUS_VARIANT: Record<DeferredScopeItem["status"], "secondary" | "default" | "outline"> = {
  pending: "secondary",
  acknowledged: "default",
  dismissed: "outline",
};

export default function DeferredScopePanel({ planReviewId }: Props) {
  const qc = useQueryClient();
  const { data: items = [], isLoading } = useDeferredScope(planReviewId);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  const refresh = () =>
    qc.invalidateQueries({ queryKey: ["deferred_scope", planReviewId] });

  const setStatus = async (
    item: DeferredScopeItem,
    status: DeferredScopeItem["status"],
  ) => {
    setBusyId(item.id);
    try {
      await updateDeferredScopeItem(item.id, {
        status,
        reviewer_notes: noteDrafts[item.id] ?? item.reviewer_notes,
      });
      toast.success(
        status === "acknowledged"
          ? "Marked as acknowledged"
          : status === "dismissed"
            ? "Item dismissed"
            : "Reset to pending",
      );
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setBusyId(null);
    }
  };

  if (isLoading) {
    return (
      <Card className="p-6">
        <Loader2 className="h-4 w-4 animate-spin" />
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        <FileWarning className="mx-auto mb-3 h-8 w-8 opacity-40" />
        No deferred-submittal items detected on the cover or general-notes sheets.
        <div className="mt-1 text-xs">
          Re-run the pipeline if cover sheets were updated.
        </div>
      </Card>
    );
  }

  const pendingCount = items.filter((i) => i.status === "pending").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {items.length} deferred submittal{items.length === 1 ? "" : "s"} detected
          {pendingCount > 0 ? ` · ${pendingCount} pending review` : ""}
        </span>
      </div>

      {items.map((item) => {
        const conf = typeof item.confidence_score === "number"
          ? `${Math.round(item.confidence_score * 100)}%`
          : "—";
        const draft = noteDrafts[item.id] ?? item.reviewer_notes ?? "";
        return (
          <Card key={item.id} className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="font-semibold text-foreground">
                    {DEFERRED_SCOPE_LABELS[item.category] ?? item.category}
                  </h4>
                  <Badge variant={STATUS_VARIANT[item.status]} className="capitalize">
                    {item.status}
                  </Badge>
                  {item.sheet_refs.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {item.sheet_refs.map((ref, i) => (
                        <Badge
                          key={`${ref}-${i}`}
                          variant="outline"
                          className="font-mono text-[10px] px-1.5 py-0 gap-1 border-primary/30 bg-primary/5 text-primary"
                        >
                          <FileText className="h-2.5 w-2.5" />
                          {ref}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-sm text-foreground">{item.description}</p>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                Confidence {conf}
              </span>
            </div>

            {item.required_submittal && (
              <div className="text-sm">
                <span className="font-medium text-foreground">Required submittal: </span>
                <span className="text-muted-foreground">{item.required_submittal}</span>
              </div>
            )}
            {item.responsible_party && (
              <div className="text-sm">
                <span className="font-medium text-foreground">Responsible: </span>
                <span className="text-muted-foreground">{item.responsible_party}</span>
              </div>
            )}

            {item.evidence.length > 0 && (
              <Collapsible>
                <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-left transition-colors hover:bg-muted/60">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Evidence from plans · {item.evidence.length} snippet
                    {item.evidence.length === 1 ? "" : "s"}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
                  <ul className="mt-2 space-y-1.5 rounded-md border border-border/40 bg-muted/20 p-3 text-xs">
                    {item.evidence.map((e, i) => (
                      <li
                        key={i}
                        className="border-l-2 border-primary/40 pl-2 font-mono leading-relaxed text-foreground"
                      >
                        "{e}"
                      </li>
                    ))}
                  </ul>
                </CollapsibleContent>
              </Collapsible>
            )}

            <Textarea
              value={draft}
              onChange={(e) =>
                setNoteDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))
              }
              placeholder="Reviewer notes (optional)…"
              className="min-h-[60px] text-sm"
            />

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="default"
                disabled={busyId === item.id || item.status === "acknowledged"}
                onClick={() => setStatus(item, "acknowledged")}
              >
                <Check className="mr-1 h-3.5 w-3.5" />
                Acknowledge
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busyId === item.id || item.status === "dismissed"}
                onClick={() => setStatus(item, "dismissed")}
              >
                <X className="mr-1 h-3.5 w-3.5" />
                Dismiss
              </Button>
              {item.status !== "pending" && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busyId === item.id}
                  onClick={() => setStatus(item, "pending")}
                >
                  Reset
                </Button>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
