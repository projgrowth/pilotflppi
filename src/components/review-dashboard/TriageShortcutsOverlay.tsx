import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["J"], label: "Next finding" },
  { keys: ["K"], label: "Previous finding" },
  { keys: ["C"], label: "Confirm active finding" },
  { keys: ["R"], label: "Reject active finding (opens reason)" },
  { keys: ["M"], label: "Mark active finding as Modify" },
  { keys: ["Space"], label: "Toggle selection (for bulk actions)" },
  { keys: ["A"], label: "Select / deselect all visible" },
  { keys: ["?"], label: "Show this overlay" },
  { keys: ["Esc"], label: "Clear selection / close overlays" },
];

export default function TriageShortcutsOverlay({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Triage shortcuts</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5">
          {SHORTCUTS.map((s) => (
            <div
              key={s.label}
              className="flex items-center justify-between gap-3 py-1 border-b border-border/40 last:border-0"
            >
              <span className="text-sm text-foreground/85">{s.label}</span>
              <div className="flex items-center gap-1">
                {s.keys.map((k, i) => (
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
