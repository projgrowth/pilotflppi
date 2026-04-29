/**
 * ReviewNextStepRail — single, prioritized "what to do next" CTA.
 *
 * Replaces the simultaneous render of:
 *  - inline "Pages not prepared" red strip
 *  - StuckRecoveryBanner's `needs_preparation` variant
 *  - SubmittalIncompleteBanner
 *  - DNAConfirmCard (when used as a CTA)
 *  - aiCompleteFlash on the Analyze button (which vanished in 3s)
 *
 * The selector lives in `src/lib/review-next-step.ts` so the priority ladder
 * is testable without React. This file is purely presentation + CTA wiring.
 */
import { Loader2, ArrowRight, Wand2, AlertTriangle, AlertCircle, Sparkles, FileText, CheckCircle2, Send, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { NextStep, NextStepKind, NextStepTone } from "@/lib/review-next-step";

interface Props {
  step: NextStep;
  busy?: boolean;
  onPrimary?: () => void;
  onSecondary?: () => void;
}

const ICONS: Record<NextStepKind, typeof Wand2> = {
  upload_failed: Upload,
  needs_preparation: Wand2,
  partial_rasterize: Wand2,
  pipeline_error: AlertTriangle,
  submittal_incomplete: AlertTriangle,
  dna_unconfirmed: Sparkles,
  needs_human_review: AlertCircle,
  findings_ready_no_letter: FileText,
  letter_ready_to_send: Send,
  sent_awaiting_resub: CheckCircle2,
  complete: CheckCircle2,
  idle: Loader2,
};

const TONE_CLASSES: Record<NextStepTone, { wrap: string; icon: string; label: string }> = {
  danger: {
    wrap: "border-destructive/40 bg-destructive/5",
    icon: "text-destructive",
    label: "text-destructive",
  },
  warning: {
    wrap: "border-warning/40 bg-warning/5",
    icon: "text-warning",
    label: "text-warning-foreground",
  },
  primary: {
    wrap: "border-accent/40 bg-accent/5",
    icon: "text-accent",
    label: "text-accent",
  },
  success: {
    wrap: "border-success/40 bg-success/5",
    icon: "text-success",
    label: "text-success",
  },
  muted: {
    wrap: "border-border/60 bg-muted/30",
    icon: "text-muted-foreground",
    label: "text-muted-foreground",
  },
};

export function ReviewNextStepRail({ step, busy, onPrimary, onSecondary }: Props) {
  // The "idle" tone with no CTA is informational chrome only — render a slim
  // version so we don't add visual weight when the pipeline is just chugging.
  const isAmbient = step.kind === "idle" && !step.ctaLabel;
  const Icon = ICONS[step.kind] ?? Sparkles;
  const tone = TONE_CLASSES[step.tone];

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-md border px-3 py-2",
        tone.wrap,
        isAmbient && "py-1.5",
      )}
      role={step.tone === "danger" ? "alert" : "status"}
      aria-live={step.tone === "danger" ? "assertive" : "polite"}
    >
      <Icon
        className={cn("h-4 w-4 shrink-0 mt-0.5", tone.icon, step.kind === "idle" && "animate-spin")}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className={cn("text-xs font-semibold leading-tight", tone.label)}>
          {step.headline}
        </p>
        {step.detail && !isAmbient && (
          <p className="mt-0.5 text-2xs text-muted-foreground leading-snug">
            {step.detail}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {step.secondaryLabel && onSecondary && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onSecondary}
            disabled={busy}
            className="h-7 text-2xs"
          >
            {step.secondaryLabel}
          </Button>
        )}
        {step.ctaLabel && onPrimary && (
          <Button
            size="sm"
            variant={step.tone === "danger" ? "destructive" : "default"}
            onClick={onPrimary}
            disabled={busy}
            className="h-7 text-2xs"
          >
            {busy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
            {step.ctaLabel}
            {!busy && <ArrowRight className="h-3 w-3 ml-1" />}
          </Button>
        )}
      </div>
    </div>
  );
}
