/**
 * UploadFailureRecoveryDialog — last-mile recovery surface when in-browser
 * page rasterization couldn't produce a usable manifest.
 *
 * Shown only after the upload pipeline AND a single auto-retry both produce
 * <80% page coverage. Replaces the historical "4 stacked toasts then dump
 * the user on the workspace with no CTA" failure mode.
 *
 * Pure presentation: parent owns retry/reupload/delete handlers.
 */
import { useState } from "react";
import { AlertTriangle, RefreshCw, Upload, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface FailedFile {
  fileName: string;
  failedPages: number;
  sampleReason: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prepared: number;
  expected: number;
  failedFiles: FailedFile[];
  retrying: boolean;
  onRetry: () => void;
  onReupload: () => void;
  onDelete?: () => void;
}

export function UploadFailureRecoveryDialog({
  open,
  onOpenChange,
  prepared,
  expected,
  failedFiles,
  retrying,
  onRetry,
  onReupload,
  onDelete,
}: Props) {
  const [showDetails, setShowDetails] = useState(false);
  const isHardFailure = prepared === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mb-1 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <DialogTitle className="text-base">
              {isHardFailure
                ? "We couldn't render this PDF"
                : `Only ${prepared} of ${expected} pages prepared`}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            {isHardFailure ? (
              <>
                Your browser couldn't rasterize the uploaded plan. Common causes:
                a scanned image PDF without a text layer, password protection, a
                corrupt header, or a blocked PDF worker (corporate VPN / restrictive
                wifi).
              </>
            ) : (
              <>
                Some pages didn't render. The pipeline can't run on a partial
                manifest. Retry below — usually it's a transient memory or
                network hiccup.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {failedFiles.length > 0 && (
          <div className="rounded-md border bg-muted/30 px-3 py-2">
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              className="flex w-full items-center justify-between text-2xs font-medium text-muted-foreground hover:text-foreground"
            >
              <span>
                {failedFiles.length} file{failedFiles.length === 1 ? "" : "s"} affected
              </span>
              {showDetails ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </button>
            {showDetails && (
              <ul className="mt-2 space-y-1 text-2xs">
                {failedFiles.map((f) => (
                  <li key={f.fileName} className="text-muted-foreground">
                    <span className="font-mono text-foreground">{f.fileName}</span>
                    <span className="ml-1">
                      — {f.failedPages} page{f.failedPages === 1 ? "" : "s"} failed
                    </span>
                    {f.sampleReason && (
                      <span className="ml-1 italic">({f.sampleReason})</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <div className="flex gap-2">
            {onDelete && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onDelete}
                disabled={retrying}
                className="h-8 text-xs text-destructive hover:bg-destructive/5 hover:text-destructive"
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete review
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onReupload}
              disabled={retrying}
              className="h-8 text-xs"
            >
              <Upload className="mr-1.5 h-3.5 w-3.5" /> Try a different file
            </Button>
            <Button
              size="sm"
              onClick={onRetry}
              disabled={retrying}
              className="h-8 text-xs"
            >
              <RefreshCw
                className={`mr-1.5 h-3.5 w-3.5 ${retrying ? "animate-spin" : ""}`}
              />
              {retrying ? "Retrying…" : "Retry rasterization"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
