import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { REVIEW_SHORTCUTS } from "@/lib/review-shortcuts";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function TriageShortcutsOverlay({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Review shortcuts</DialogTitle>
          <DialogDescription>Keyboard shortcuts for moving through findings during triage.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          {REVIEW_SHORTCUTS.map((s) => (
            <div
              key={s.key}
              className="flex items-center justify-between gap-3 py-1 border-b border-border/40 last:border-0"
            >
              <span className="text-sm text-foreground/85">{s.description}</span>
              <div className="flex items-center gap-1">
                {s.label.split("+").map((k, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center justify-center min-w-[1.6rem] h-6 px-1.5 rounded border border-border bg-muted/40 text-2xs font-mono font-semibold text-foreground/80"
                  >
                    {k}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-2xs text-muted-foreground pt-1">
          Shortcuts are disabled while typing in inputs. Confirming auto-advances to the next
          unreviewed finding.
        </p>
      </DialogContent>
    </Dialog>
  );
}
