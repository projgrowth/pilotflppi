/**
 * Typed-name confirm dialog. Used for irreversible cascading deletes
 * (plan review, project). Less destructive deletes (a single file) should use
 * the simpler `useConfirm` hook with `variant: "destructive"`.
 *
 * Pattern: user must type the resource's name verbatim before the destructive
 * button enables. Matches Linear/GitHub/Vercel.
 */
import { forwardRef, useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle } from "lucide-react";

export interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What's being deleted, e.g. "project", "plan review", "file". */
  resourceLabel: string;
  /** The exact string the user must type to enable the button. */
  expectedConfirmText: string;
  /** Headline shown at the top of the dialog. */
  title: string;
  /** Plain-language explanation of what will be deleted and any cascades. */
  description: string;
  /** Optional bulleted list of cascade items shown above the input. */
  cascadeItems?: string[];
  /** Loading state — disables the button and shows a spinner. */
  loading?: boolean;
  /** Called when the user confirms. Should throw on error. */
  onConfirm: () => Promise<void> | void;
}

// forwardRef so callers can wrap us in <Tooltip asChild> or any Radix slot
// pattern without React warning about refs being passed to a function component.
export const DeleteConfirmDialog = forwardRef<HTMLDivElement, DeleteConfirmDialogProps>(function DeleteConfirmDialog({
  open, onOpenChange, resourceLabel, expectedConfirmText,
  title, description, cascadeItems, loading, onConfirm,
}, _ref) {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (open) setTyped("");
  }, [open]);

  const matches = typed.trim() === expectedConfirmText.trim() && expectedConfirmText.length > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !loading && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-destructive/10 p-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
            </div>
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription className="pt-2">{description}</DialogDescription>
        </DialogHeader>

        {cascadeItems && cascadeItems.length > 0 && (
          <ul className="list-disc pl-5 space-y-1 text-xs text-muted-foreground">
            {cascadeItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}

        <div className="space-y-2 pt-2">
          <Label htmlFor="confirm-name" className="text-xs">
            Type <span className="font-mono font-semibold text-foreground">{expectedConfirmText}</span> to confirm
          </Label>
          <Input
            id="confirm-name"
            autoFocus
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={`Type the ${resourceLabel} name`}
            disabled={loading}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!matches || loading}
            onClick={async () => {
              try {
                await onConfirm();
                onOpenChange(false);
              } catch {
                /* caller surfaces the error toast */
              }
            }}
          >
            {loading && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Delete {resourceLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
