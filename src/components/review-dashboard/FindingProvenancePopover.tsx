import { Info } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { type DeficiencyV2Row } from "@/hooks/useReviewDashboard";

interface Props {
  def: DeficiencyV2Row & { model_version?: string | null };
}

/**
 * Hover/click popover that consolidates the "why this finding exists" provenance
 * trail: prompt version, model, confidence basis, raw evidence, verification.
 * Lets a reviewer defend a finding to a contractor in one glance.
 */
export default function FindingProvenancePopover({ def }: Props) {
  const evidence = (def.evidence ?? []).filter(Boolean);
  const codeRef = def.code_reference;
  const codeRefStr = codeRef
    ? [codeRef.code, codeRef.section, codeRef.edition && `(${codeRef.edition})`]
        .filter(Boolean)
        .join(" ")
    : null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-6 items-center gap-1 rounded border border-border/60 bg-muted/30 px-1.5 text-2xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Show finding provenance"
        >
          <Info className="h-3 w-3" />
          Why
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="border-b bg-muted/40 px-3 py-2">
          <div className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
            Provenance
          </div>
          <div className="mt-0.5 font-mono text-xs">{def.def_number} · {def.discipline}</div>
        </div>
        <div className="space-y-2 p-3 text-xs">
          <Row label="Model">
            {def.model_version ? (
              <span className="font-mono">{def.model_version}</span>
            ) : (
              <span className="text-muted-foreground">unknown</span>
            )}
          </Row>
          <Row label="Confidence">
            {typeof def.confidence_score === "number" ? (
              <span className="font-mono">{def.confidence_score.toFixed(2)}</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Row>
          {def.confidence_basis && (
            <Row label="Basis">
              <span className="text-muted-foreground">{def.confidence_basis}</span>
            </Row>
          )}
          {codeRefStr && (
            <Row label="Code">
              <span className="font-mono">{codeRefStr}</span>
            </Row>
          )}
          <Row label="Verification">
            <span
              className={
                def.verification_status === "verified"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : def.verification_status === "overturned"
                    ? "text-destructive"
                    : def.verification_status === "modified"
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-muted-foreground"
              }
            >
              {def.verification_status}
            </span>
          </Row>
          {def.verification_notes && (
            <div className="rounded-md bg-muted/40 p-2 text-2xs text-muted-foreground">
              {def.verification_notes}
            </div>
          )}
          {evidence.length > 0 && (
            <div>
              <div className="mb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                Evidence ({evidence.length})
              </div>
              <ul className="max-h-40 space-y-1 overflow-y-auto border-l-2 border-primary/40 pl-2">
                {evidence.map((e, i) => (
                  <li key={i} className="font-mono text-2xs leading-relaxed text-muted-foreground">
                    "{e}"
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-right">{children}</span>
    </div>
  );
}
