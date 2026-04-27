import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCheck,
  MapPin,
  Clock,
  ArrowRightLeft,
  ChevronRight,
  History,
  Move,
  Crosshair,
  Eye,
  ImageIcon,
  Repeat,
  Check,
  X,
  Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, forwardRef } from "react";
import { useSimilarCorrections } from "@/hooks/useSimilarCorrections";
import { useAuth } from "@/contexts/AuthContext";
import { useFirmId } from "@/hooks/useFirmId";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { FindingStatus } from "@/components/FindingStatusFilter";
import type { FindingHistoryEntry } from "@/hooks/useFindingHistory";
import type { Finding } from "@/types";

export type { Finding } from "@/types";

/**
 * Severity → spec'd color tokens.
 * HIGH (critical) → red, MEDIUM (major) → yellow, LOW (minor) → gray.
 * Uses semantic tokens so light/dark themes work without raw color leakage.
 */
const severityConfig: Record<
  string,
  {
    icon: typeof AlertTriangle;
    dot: string;
    badge: string;
    label: string;
  }
> = {
  critical: {
    icon: AlertTriangle,
    dot: "bg-destructive",
    badge: "bg-destructive/10 text-destructive border-destructive/30",
    label: "HIGH",
  },
  major: {
    icon: AlertCircle,
    dot: "bg-warning",
    badge: "bg-warning/10 text-warning border-warning/30",
    label: "MEDIUM",
  },
  minor: {
    icon: Info,
    dot: "bg-muted-foreground/40",
    badge: "bg-muted text-muted-foreground border-border",
    label: "LOW",
  },
};

const statusOptions: { value: FindingStatus; icon: typeof Clock; label: string; className: string }[] = [
  { value: "open", icon: Clock, label: "Open", className: "text-destructive" },
  { value: "resolved", icon: CheckCheck, label: "Resolved", className: "text-success" },
  { value: "deferred", icon: ArrowRightLeft, label: "Deferred", className: "text-warning" },
];

type OverrideReason =
  | "Not Applicable"
  | "Already Addressed"
  | "Incorrect Code Reference"
  | "Other";

const OVERRIDE_REASONS: OverrideReason[] = [
  "Not Applicable",
  "Already Addressed",
  "Incorrect Code Reference",
  "Other",
];

interface FindingCardProps {
  finding: Finding;
  index: number;
  globalIndex?: number;
  isActive?: boolean;
  onLocateClick?: () => void;
  onRepositionClick?: () => void;
  animationDelay?: number;
  status?: FindingStatus;
  onStatusChange?: (status: FindingStatus) => void;
  defaultExpanded?: boolean;
  history?: FindingHistoryEntry[];
}

export const FindingCard = forwardRef<HTMLDivElement, FindingCardProps>(
  (
    {
      finding,
      index,
      globalIndex,
      isActive,
      onLocateClick,
      onRepositionClick,
      animationDelay = 0,
      status = "open",
      onStatusChange,
      defaultExpanded = false,
      history = [],
    },
    ref,
  ) => {
    const [expanded, setExpanded] = useState(defaultExpanded);
    const [showHistory, setShowHistory] = useState(false);
    const [showReasoning, setShowReasoning] = useState(false);
    const [overrideOpen, setOverrideOpen] = useState(false);
    const [savingAccept, setSavingAccept] = useState(false);
    const [savingOverride, setSavingOverride] = useState(false);
    const [correctedFinding, setCorrectedFinding] = useState(finding.description || "");
    const [overrideReason, setOverrideReason] = useState<OverrideReason | "">("");
    const [overrideNotes, setOverrideNotes] = useState("");

    const { user } = useAuth();
    const { firmId } = useFirmId();

    const similarCount =
      useSimilarCorrections(finding.code_ref, finding.description) ?? finding.similar_corrections_count ?? 0;
    const sev = severityConfig[finding.severity] || severityConfig.minor;
    const isResolved = status === "resolved";
    const isDeferred = status === "deferred";
    const displayIndex = globalIndex !== undefined ? globalIndex : index;

    const cycleStatus = () => {
      if (!onStatusChange) return;
      const order: FindingStatus[] = ["open", "resolved", "deferred"];
      const nextIdx = (order.indexOf(status) + 1) % order.length;
      onStatusChange(order[nextIdx]);
    };

    const currentStatusOption = statusOptions.find((s) => s.value === status)!;
    const StatusIcon = currentStatusOption.icon;
    const isExpanded = expanded || isActive;

    /**
     * Accept → mark resolved + log a confirming "correction" so the AI learning
     * loop knows this finding was acceptable as-is. We keep the existing
     * deficiencies_v2 status flow (via onStatusChange) and additionally write
     * to the corrections table for the learning pipeline.
     */
    const handleAccept = async () => {
      if (savingAccept) return;
      if (!user?.id) {
        toast.error("Sign in required");
        return;
      }
      setSavingAccept(true);
      try {
        // Status update — drives existing dashboards, history, and letter linter.
        if (onStatusChange) onStatusChange("resolved");

        // Learning loop — confirming correction (no value changed).
        const { error } = await supabase.from("corrections").insert({
          user_id: user.id,
          firm_id: firmId,
          fbc_section: finding.code_ref || null,
          original_value: finding.description || null,
          corrected_value: finding.description || null,
          correction_type: "confirm",
          context_notes: "Reviewer accepted finding as-is",
        });
        if (error) throw error;
        toast.success("Finding accepted");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to accept finding");
      } finally {
        setSavingAccept(false);
      }
    };

    const handleOverrideSubmit = async () => {
      if (savingOverride) return;
      if (!user?.id) {
        toast.error("Sign in required");
        return;
      }
      const trimmedFinding = correctedFinding.trim();
      if (!trimmedFinding) {
        toast.error("Corrected finding is required");
        return;
      }
      if (!overrideReason) {
        toast.error("Select a reason for the override");
        return;
      }
      if (trimmedFinding.length > 4000 || overrideNotes.length > 4000) {
        toast.error("Input too long");
        return;
      }

      setSavingOverride(true);
      try {
        const contextNotes = [
          `reason=${overrideReason}`,
          overrideNotes.trim() ? `notes=${overrideNotes.trim()}` : null,
          finding.finding_id ? `finding_id=${finding.finding_id}` : null,
        ]
          .filter(Boolean)
          .join(" | ");

        const { error } = await supabase.from("corrections").insert({
          user_id: user.id,
          firm_id: firmId,
          fbc_section: finding.code_ref || null,
          original_value: finding.description || null,
          corrected_value: trimmedFinding,
          correction_type: "override",
          context_notes: contextNotes,
        });
        if (error) throw error;

        // Treat overrides as resolved — the AI was wrong, reviewer corrected it.
        if (onStatusChange) onStatusChange("resolved");

        toast.success("Override saved");
        setOverrideOpen(false);
        setOverrideNotes("");
        setOverrideReason("");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to save override");
      } finally {
        setSavingOverride(false);
      }
    };

    const handleOverrideCancel = () => {
      setOverrideOpen(false);
      setCorrectedFinding(finding.description || "");
      setOverrideNotes("");
      setOverrideReason("");
    };

    return (
      <div
        ref={ref}
        className={cn(
          "relative rounded-md border overflow-hidden transition-all duration-150",
          "animate-in fade-in slide-in-from-bottom-1",
          isActive && "ring-2 ring-accent bg-accent/5",
          isResolved && "opacity-60",
          isDeferred && "opacity-70",
        )}
        style={{ animationDelay: `${animationDelay}ms`, animationFillMode: "backwards" }}
      >
        {/* Collapsed: single-line summary (clickable to expand) */}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className={cn(
            "w-full text-left px-2.5 py-1.5 hover:bg-muted/30 transition-colors",
            isExpanded && "border-b border-border/30",
          )}
        >
          <div className="flex items-center gap-1.5">
            <div className={cn("h-1.5 w-1.5 rounded-full shrink-0", sev.dot, isResolved && "opacity-30")} />
            <span className="text-caption font-mono text-muted-foreground/50 w-3 text-right shrink-0">
              {displayIndex + 1}
            </span>
            <code className="text-2xs font-mono text-foreground/70 shrink-0">{finding.code_ref}</code>
            <span
              className={cn(
                "text-xs text-foreground/75 truncate flex-1 min-w-0",
                isResolved && "line-through decoration-muted-foreground/30",
              )}
            >
              {finding.description}
            </span>
            {status !== "open" && (
              <span className={cn("text-caption font-semibold shrink-0", currentStatusOption.className)}>
                {currentStatusOption.label}
              </span>
            )}
            <ChevronRight
              className={cn(
                "h-3 w-3 text-muted-foreground/30 shrink-0 transition-transform duration-150",
                isExpanded && "rotate-90",
              )}
            />
          </div>
        </button>

        {/* Expanded details */}
        {isExpanded && (
          <div className="px-3 py-2 space-y-2">
            {/* Severity badge (per spec) + meta chips */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge
                className={cn(
                  "text-2xs uppercase font-semibold border h-5 px-1.5 tracking-wide",
                  sev.badge,
                )}
              >
                {sev.label}
              </Badge>
              {finding.confidence && (
                <Badge
                  variant="outline"
                  className={cn(
                    "text-caption font-medium h-3.5 px-1",
                    finding.confidence === "verified"
                      ? "border-success/40 text-success"
                      : finding.confidence === "likely"
                        ? "border-accent/40 text-accent"
                        : "border-muted-foreground/30 text-muted-foreground",
                  )}
                >
                  {finding.confidence}
                </Badge>
              )}
              {finding.page && (
                <span className="text-caption text-muted-foreground">pg {finding.page}</span>
              )}
              {finding.county_specific && (
                <Badge
                  variant="outline"
                  className="text-caption font-medium border-accent text-accent bg-accent/5 h-3.5 px-1"
                >
                  County
                </Badge>
              )}
              {similarCount >= 3 && (
                <Badge
                  variant="outline"
                  className="text-caption font-semibold border-warning/50 text-warning bg-warning/10 h-3.5 px-1 inline-flex items-center gap-0.5"
                  title={`${similarCount} prior reviewer corrections matched this code section.`}
                >
                  <Repeat className="h-2.5 w-2.5" /> Corrected {similarCount}× before
                </Badge>
              )}
            </div>

            {/* Finding text (per spec: text-sm text-foreground/85 — themed equivalent of text-gray-800) */}
            <p
              className={cn(
                "text-sm leading-relaxed text-foreground/85",
                isResolved && "line-through decoration-muted-foreground/30",
              )}
            >
              {finding.description}
            </p>

            {/* FBC section reference (per spec: text-xs font-mono text-muted-foreground) */}
            {finding.code_ref && (
              <p className="text-xs font-mono text-muted-foreground">{finding.code_ref}</p>
            )}

            {/* Recommendation */}
            {finding.recommendation && (
              <div className="rounded bg-muted/40 border border-border/40 px-2.5 py-2">
                <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">
                  Recommendation
                </p>
                <p className="text-xs text-foreground/75 leading-relaxed">{finding.recommendation}</p>
              </div>
            )}

            {/* Approximate-location hint */}
            {finding.markup &&
              finding.markup.pin_confidence &&
              finding.markup.pin_confidence !== "high" && (
                <div
                  className={cn(
                    "flex items-center gap-1.5 rounded border px-2 py-1.5",
                    finding.markup.pin_confidence === "low"
                      ? "bg-warning/10 border-warning/40"
                      : "bg-muted/40 border-border/40",
                  )}
                >
                  <Crosshair
                    className={cn(
                      "h-3 w-3 shrink-0",
                      finding.markup.pin_confidence === "low" ? "text-warning" : "text-muted-foreground",
                    )}
                  />
                  <p className="text-2xs text-foreground/80 flex-1 leading-snug">
                    <span className="font-semibold">
                      {finding.markup.pin_confidence === "low"
                        ? "Approximate location"
                        : "Pin placed by grid cell"}
                    </span>
                    {finding.markup.nearest_text ? (
                      <>
                        {" "}
                        — look near{" "}
                        <span className="font-mono text-foreground">"{finding.markup.nearest_text}"</span>
                      </>
                    ) : finding.markup.grid_cell ? (
                      <>
                        {" "}
                        — search cell{" "}
                        <span className="font-mono text-foreground">{finding.markup.grid_cell}</span>
                      </>
                    ) : (
                      <> — verify on sheet</>
                    )}
                  </p>
                  {onRepositionClick && (
                    <button
                      className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-medium text-warning hover:bg-warning/20 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRepositionClick();
                      }}
                    >
                      <Move className="h-3 w-3" /> Place pin
                    </button>
                  )}
                </div>
              )}

            {/* PRIMARY ACTIONS — Accept / Override (spec) */}
            {!overrideOpen && (
              <div className="flex items-center gap-1.5 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAccept();
                  }}
                  disabled={savingAccept || isResolved}
                  className={cn(
                    "h-7 px-2.5 text-xs gap-1",
                    "border-success/40 text-success hover:bg-success/10 hover:text-success",
                  )}
                >
                  <Check className="h-3 w-3" />
                  {isResolved ? "Accepted" : savingAccept ? "Accepting…" : "Accept"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOverrideOpen(true);
                  }}
                  className="h-7 px-2.5 text-xs gap-1 border-warning/40 text-warning hover:bg-warning/10 hover:text-warning"
                >
                  <Pencil className="h-3 w-3" />
                  Override
                </Button>

                {/* Secondary actions kept compact, behind the primary CTAs */}
                {finding.markup && onLocateClick && (
                  <button
                    className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs text-muted-foreground hover:text-accent hover:bg-accent/10 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      onLocateClick();
                    }}
                  >
                    <MapPin className="h-3 w-3" /> Locate
                  </button>
                )}
                {finding.reasoning && (
                  <button
                    className={cn(
                      "flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs transition-colors",
                      showReasoning
                        ? "text-accent bg-accent/10"
                        : "text-muted-foreground hover:text-accent hover:bg-accent/10",
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowReasoning(!showReasoning);
                    }}
                    title="See exactly what the AI observed and why it flagged this"
                  >
                    <Eye className="h-3 w-3" /> Why?
                  </button>
                )}
              </div>
            )}

            {/* INLINE OVERRIDE FORM */}
            {overrideOpen && (
              <div
                className="rounded-md border border-warning/40 bg-warning/5 p-2.5 space-y-2"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between">
                  <p className="text-2xs font-semibold uppercase tracking-wide text-warning">
                    Override finding
                  </p>
                  <button
                    type="button"
                    onClick={handleOverrideCancel}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Cancel override"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="space-y-1">
                  <Label htmlFor={`override-finding-${displayIndex}`} className="text-2xs font-medium">
                    Corrected Finding
                  </Label>
                  <Textarea
                    id={`override-finding-${displayIndex}`}
                    value={correctedFinding}
                    onChange={(e) => setCorrectedFinding(e.target.value.slice(0, 4000))}
                    placeholder="Rewrite the finding as it should read…"
                    className="text-xs min-h-[64px] resize-y"
                    maxLength={4000}
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-2xs font-medium">Reason for Override</Label>
                  <Select
                    value={overrideReason}
                    onValueChange={(v) => setOverrideReason(v as OverrideReason)}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select a reason…" />
                    </SelectTrigger>
                    <SelectContent>
                      {OVERRIDE_REASONS.map((r) => (
                        <SelectItem key={r} value={r} className="text-xs">
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor={`override-notes-${displayIndex}`} className="text-2xs font-medium">
                    Notes <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <Textarea
                    id={`override-notes-${displayIndex}`}
                    value={overrideNotes}
                    onChange={(e) => setOverrideNotes(e.target.value.slice(0, 4000))}
                    placeholder="Additional context for the AI learning loop…"
                    className="text-xs min-h-[48px] resize-y"
                    maxLength={4000}
                  />
                </div>

                <div className="flex items-center justify-end gap-1.5 pt-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleOverrideCancel}
                    disabled={savingOverride}
                    className="h-7 px-2.5 text-xs"
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleOverrideSubmit}
                    disabled={savingOverride || !correctedFinding.trim() || !overrideReason}
                    className="h-7 px-2.5 text-xs"
                  >
                    {savingOverride ? "Saving…" : "Submit override"}
                  </Button>
                </div>
              </div>
            )}

            {/* Tertiary: status cycle + history (kept for reviewer workflow) */}
            <div className="flex items-center gap-1 pt-0.5">
              <button
                className={cn(
                  "flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs transition-colors",
                  currentStatusOption.className,
                  "opacity-60 hover:opacity-100 hover:bg-muted/50",
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  cycleStatus();
                }}
                title={`${currentStatusOption.label} — Click to change`}
              >
                <StatusIcon className="h-3 w-3" /> {currentStatusOption.label}
              </button>
              {finding.markup &&
                onRepositionClick &&
                finding.markup.pin_confidence === "high" && (
                  <button
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs text-muted-foreground hover:text-warning hover:bg-warning/10 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRepositionClick();
                    }}
                    title="Pin in the wrong place? Click to reposition."
                  >
                    <Move className="h-3 w-3" /> Wrong location?
                  </button>
                )}
              {history.length > 0 && (
                <button
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors ml-auto"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowHistory(!showHistory);
                  }}
                >
                  <History className="h-3 w-3" /> {history.length}
                </button>
              )}
            </div>

            {/* AI reasoning disclosure */}
            {showReasoning && finding.reasoning && (
              <div className="rounded border border-accent/30 bg-accent/5 px-2.5 py-2 space-y-1.5">
                <div className="flex items-center gap-1 text-2xs font-semibold text-accent uppercase tracking-wide">
                  <Eye className="h-3 w-3" /> AI Observation
                </div>
                <p className="text-xs text-foreground/85 leading-relaxed">{finding.reasoning}</p>
                {(finding.crop_url || finding.evidence_crop_url) && (
                  <div className="space-y-1 pt-1 border-t border-accent/15">
                    <div className="flex items-center gap-1 text-2xs font-semibold text-muted-foreground uppercase tracking-wide">
                      <ImageIcon className="h-3 w-3" />
                      {finding.crop_url ? "Image evidence" : "Cited sheet"}
                    </div>
                    <img
                      src={finding.crop_url || finding.evidence_crop_url || ""}
                      alt={`Evidence for finding ${finding.code_ref}`}
                      className="w-full max-h-64 object-contain rounded border border-border/40 bg-card"
                      loading="lazy"
                    />
                  </div>
                )}
                {(finding.model_version || finding.prompt_version) && (
                  <p className="text-caption font-mono text-muted-foreground/70 pt-0.5 border-t border-accent/15">
                    {finding.model_version && <span>{finding.model_version}</span>}
                    {finding.model_version && finding.prompt_version && <span> · </span>}
                    {finding.prompt_version && <span>prompt {finding.prompt_version}</span>}
                  </p>
                )}
              </div>
            )}

            {/* History log */}
            {showHistory && history.length > 0 && (
              <div className="border-t border-border/30 pt-1.5 mt-1 space-y-1">
                <p className="text-caption font-semibold text-muted-foreground uppercase tracking-wide">
                  Audit Trail
                </p>
                {history.slice(0, 10).map((h) => (
                  <div key={h.id} className="flex items-center gap-1.5 text-caption text-muted-foreground">
                    <span className="font-mono">
                      {new Date(h.changed_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <span className="text-muted-foreground/50">•</span>
                    <span className="capitalize">{h.old_status}</span>
                    <span className="text-muted-foreground/50">→</span>
                    <span className="capitalize font-medium text-foreground/70">{h.new_status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  },
);

FindingCard.displayName = "FindingCard";
