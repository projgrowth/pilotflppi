/**
 * AuditCoveragePanel — combines the three least-trafficked dashboard tabs
 * (Dedupe Audit · Project DNA · Sheet Coverage) into one inspection surface
 * with an inner sub-nav. These are diagnostic, not workflow — collapsing them
 * here keeps the top-level tab bar focused on what reviewers actually do.
 */
import { useState } from "react";
import { cn } from "@/lib/utils";
import DedupeAuditTrail from "./DedupeAuditTrail";
import ProjectDNAViewer from "./ProjectDNAViewer";
import SheetCoverageMap from "./SheetCoverageMap";

type Section = "dedupe" | "dna" | "coverage";

interface Props {
  planReviewId: string;
  jurisdictionMismatch: boolean;
  dedupeMergeCount: number;
  initialSection?: Section;
  onJumpToFindings: () => void;
  onAfterDnaRerun: () => void;
}

export default function AuditCoveragePanel({
  planReviewId,
  jurisdictionMismatch,
  dedupeMergeCount,
  initialSection = "dedupe",
  onJumpToFindings,
  onAfterDnaRerun,
}: Props) {
  const [section, setSection] = useState<Section>(initialSection);

  const tabs: Array<{ key: Section; label: string; badge?: number }> = [
    { key: "dedupe", label: "Dedupe audit", badge: dedupeMergeCount || undefined },
    { key: "dna", label: "Project DNA" },
    { key: "coverage", label: "Sheet coverage" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1 rounded-lg border bg-muted/30 p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setSection(t.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              section === t.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background/50",
            )}
          >
            {t.label}
            {typeof t.badge === "number" && (
              <span className="rounded-full bg-muted px-1.5 font-mono text-2xs">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {section === "dedupe" && (
        <DedupeAuditTrail planReviewId={planReviewId} onJump={onJumpToFindings} />
      )}
      {section === "dna" && (
        <ProjectDNAViewer
          planReviewId={planReviewId}
          jurisdictionMismatch={jurisdictionMismatch}
          onAfterRerun={onAfterDnaRerun}
        />
      )}
      {section === "coverage" && <SheetCoverageMap planReviewId={planReviewId} />}
    </div>
  );
}
