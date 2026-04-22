import { useState } from "react";
import { Info, ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { type DeficiencyV2Row } from "@/hooks/useReviewDashboard";
import EvidenceSnippet from "./EvidenceSnippet";

interface Props {
  planReviewId: string;
  def: DeficiencyV2Row;
}

export default function DeficiencyEvidence({ planReviewId, def }: Props) {
  const evidence = (def.evidence ?? []).filter(Boolean);
  const hasContent = evidence.length > 0 || !!def.confidence_basis;
  // Default open for low-confidence findings — reviewers should see the basis up front.
  const defaultOpen =
    typeof def.confidence_score === "number" && def.confidence_score < 0.7;
  const [open, setOpen] = useState(defaultOpen);

  if (!hasContent) return null;

  const isOverturned = def.verification_status === "overturned";
  const isModified = def.verification_status === "modified";
  const isVerified = def.verification_status === "verified";

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 rounded-md border border-dashed border-border px-3 py-2 text-2xs hover:bg-muted/40"
        >
          <span className="flex items-center gap-1.5 font-medium uppercase tracking-wide text-muted-foreground">
            <Info className="h-3 w-3" />
            Why the AI flagged this
            {evidence.length > 0 && (
              <span className="font-mono">
                · {evidence.length} snippet{evidence.length === 1 ? "" : "s"}
              </span>
            )}
          </span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pt-2">
        {evidence.length > 0 && (
          <ul className="space-y-1 border-l-2 border-primary/40 pl-3">
            {evidence.map((e, i) => (
              <li
                key={i}
                className="font-mono text-xs leading-relaxed text-muted-foreground"
              >
                "{e}"
              </li>
            ))}
          </ul>
        )}
        {def.confidence_basis && (
          <div className="rounded-md bg-muted/40 p-2 text-xs">
            <span className="font-medium text-foreground">Confidence basis: </span>
            <span className="text-muted-foreground">{def.confidence_basis}</span>
          </div>
        )}
        {(isOverturned || isModified || isVerified) && def.verification_notes && (
          <div
            className={cn(
              "rounded-md p-2 text-xs",
              isOverturned && "bg-destructive/5 text-destructive",
              isModified && "bg-amber-500/10 text-amber-700 dark:text-amber-300",
              isVerified && "bg-emerald-500/5 text-emerald-700 dark:text-emerald-300",
            )}
          >
            <span className="font-medium">Verification: </span>
            {def.verification_notes}
          </div>
        )}

        {/* Lazy-render visual snippet only when the panel is open. Picks the first
            sheet_ref + first evidence quote for context. "Pin to letter" persists
            the crop for embedding in the exported comment letter. */}
        {open && (def.sheet_refs?.length ?? 0) > 0 && evidence.length > 0 && (
          <EvidenceSnippet
            planReviewId={planReviewId}
            deficiencyId={def.id}
            sheetRef={def.sheet_refs?.[0] ?? null}
            evidenceText={evidence[0] ?? ""}
            pinnedUrl={def.evidence_crop_url ?? null}
          />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
