import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Loader2, Send, Check, Copy, X, Save, Cloud, AlertCircle } from "lucide-react";
import { CountyDocumentPackage } from "@/components/CountyDocumentPackage";
import { cn } from "@/lib/utils";
import type { Finding } from "@/components/FindingCard";
import type { FindingStatus } from "@/components/FindingStatusFilter";
import type { FirmSettings } from "@/hooks/useFirmSettings";

interface LetterPanelProps {
  reviewId: string;
  projectId: string;
  projectName: string;
  address: string;
  county: string;
  jurisdiction: string;
  tradeType: string;
  round: number;
  aiCheckStatus: string;
  qcStatus: string;
  /** Reviewer-supplied audit notes captured at QC sign-off (persisted in plan_reviews.qc_notes). */
  qcNotes?: string;
  hasFindings: boolean;
  findings: Finding[];
  findingStatuses: Record<string, FindingStatus>;
  firmSettings: FirmSettings | null | undefined;
  commentLetter: string;
  generatingLetter: boolean;
  copied: boolean;
  userId?: string;
  /** Autosave indicator state. */
  autosaveState?: "idle" | "saving" | "saved" | "error";
  autosaveLastSavedAt?: Date | null;
  onGenerateLetter: () => void;
  onCancelLetter?: () => void;
  onCopyLetter: () => void;
  onLetterChange: (value: string) => void;
  onQcApprove: (notes?: string) => void;
  onQcReject: (notes?: string) => void;
  onDocumentGenerated: () => void;
  /** Validate then trigger send. Parent owns the linter dialog. */
  onSendToContractor?: () => void;
}

function formatRelative(date: Date): string {
  const sec = Math.max(1, Math.round((Date.now() - date.getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  return `${hr}h ago`;
}

export function LetterPanel({
  qcStatus, qcNotes, hasFindings, findings, findingStatuses, firmSettings,
  commentLetter, generatingLetter, copied, county, jurisdiction,
  tradeType, round, projectId, projectName, address, aiCheckStatus,
  autosaveState, autosaveLastSavedAt,
  onGenerateLetter, onCancelLetter, onCopyLetter, onLetterChange, onQcApprove, onQcReject, onDocumentGenerated, onSendToContractor,
}: LetterPanelProps) {
  const [notesDraft, setNotesDraft] = useState<string>(qcNotes ?? "");
  return (
    <div className="p-3 space-y-3">
      {/* QC Status Bar */}
      {hasFindings && aiCheckStatus === "complete" && (
        <div className={cn(
          "rounded-lg border px-3 py-2 flex items-center justify-between",
          qcStatus === "qc_approved" ? "border-success/30 bg-success/5" :
          qcStatus === "qc_rejected" ? "border-destructive/30 bg-destructive/5" :
          "border-warning/30 bg-warning/5"
        )}>
          <div className="flex items-center gap-2">
            <div className={cn("h-2 w-2 rounded-full",
              qcStatus === "qc_approved" ? "bg-success" :
              qcStatus === "qc_rejected" ? "bg-destructive" :
              "bg-warning"
            )} />
            <span className="text-xs font-semibold">
              {qcStatus === "qc_approved" ? "QC Approved" :
               qcStatus === "qc_rejected" ? "QC Rejected" : "Pending QC Review"}
            </span>
          </div>
          {qcStatus === "pending_qc" && (
            <div className="flex gap-1">
              <Button size="sm" variant="outline" className="h-6 text-2xs text-destructive border-destructive/30" onClick={() => onQcReject(notesDraft)}>
                Reject
              </Button>
              <Button size="sm" className="h-6 text-2xs bg-success text-success-foreground hover:bg-success/90" onClick={() => onQcApprove(notesDraft)}>
                Approve
              </Button>
            </div>
          )}
        </div>
      )}

      {/* QC reviewer notes — saved with sign-off into plan_reviews.qc_notes
          for the legitimacy audit trail (FS 553.791 reviewer accountability). */}
      {hasFindings && aiCheckStatus === "complete" && qcStatus === "pending_qc" && (
        <div className="space-y-1.5">
          <label className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            QC notes (optional, saved with sign-off)
          </label>
          <Textarea
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value.slice(0, 4000))}
            rows={2}
            placeholder="e.g. Verified §1006 egress dimension on A-101 against site survey."
            className="text-xs"
          />
        </div>
      )}
      {hasFindings && qcStatus !== "pending_qc" && qcNotes && qcNotes.trim().length > 0 && (
        <div className="rounded border bg-muted/40 px-2.5 py-1.5">
          <div className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">QC notes</div>
          <p className="text-xs whitespace-pre-wrap text-foreground/85">{qcNotes}</p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Comment Letter</span>
        <div className="flex items-center gap-1.5">
          {hasFindings && qcStatus === "qc_approved" && (
            <CountyDocumentPackage
              projectId={projectId}
              projectName={projectName}
              address={address}
              county={county}
              jurisdiction={jurisdiction}
              tradeType={tradeType}
              round={round}
              findings={findings}
              findingStatuses={findingStatuses}
              firmInfo={firmSettings}
              onDocumentGenerated={onDocumentGenerated}
            />
          )}
          {hasFindings && qcStatus !== "qc_approved" && (
            <span className="text-caption text-muted-foreground italic">QC approval required for export</span>
          )}
          {commentLetter && !generatingLetter && (
            <Button size="sm" variant="ghost" className="h-7 text-2xs" onClick={onCopyLetter}>
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </Button>
          )}
        </div>
      </div>
      {!hasFindings && (
        <div className="text-center py-12">
          <p className="text-xs text-muted-foreground">Run AI check first to generate findings</p>
        </div>
      )}
      {hasFindings && !commentLetter && !generatingLetter && (
        <Button variant="outline" className="w-full h-10 text-xs" onClick={onGenerateLetter}>
          <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Generate Comment Letter
        </Button>
      )}
      {(commentLetter || generatingLetter) && (
        <>
          <div className="rounded-lg border bg-background overflow-hidden">
            <div className="border-b bg-muted/30 px-4 py-2 flex items-center justify-between">
              <span className="text-2xs font-semibold uppercase tracking-widest text-muted-foreground">FLPPI — Comment Letter</span>
              <div className="flex items-center gap-2">
                {/* Autosave indicator: gives a visible signal that edits are persisted. */}
                {!generatingLetter && autosaveState && (
                  <span className={cn(
                    "flex items-center gap-1 text-2xs",
                    autosaveState === "error" ? "text-destructive" : "text-muted-foreground"
                  )}>
                    {autosaveState === "saving" && (<><Save className="h-3 w-3 animate-pulse" /> Saving…</>)}
                    {autosaveState === "saved" && autosaveLastSavedAt && (<><Cloud className="h-3 w-3 text-success" /> Saved · {formatRelative(autosaveLastSavedAt)}</>)}
                    {autosaveState === "error" && (<><AlertCircle className="h-3 w-3" /> Save failed</>)}
                  </span>
                )}
                {generatingLetter && <Loader2 className="h-3 w-3 text-accent animate-spin" />}
                {generatingLetter && onCancelLetter && (
                  <Button size="sm" variant="ghost" className="h-6 text-2xs" onClick={onCancelLetter}>
                    <X className="h-3 w-3 mr-1" /> Cancel
                  </Button>
                )}
              </div>
            </div>
            <Textarea
              value={commentLetter}
              onChange={(e) => onLetterChange(e.target.value)}
              rows={18}
              className="font-mono text-xs border-0 rounded-none focus-visible:ring-0 focus-visible:ring-offset-0 resize-y"
              placeholder={generatingLetter ? "Generating..." : ""}
            />
          </div>
          {commentLetter && !generatingLetter && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="text-xs flex-1" onClick={onGenerateLetter}>
                <Sparkles className="h-3 w-3 mr-1" /> Regenerate
              </Button>
              <Button
                size="sm"
                className="text-xs flex-1"
                disabled={qcStatus !== "qc_approved"}
                title={qcStatus !== "qc_approved" ? "QC approval required" : ""}
                onClick={onSendToContractor}
              >
                <Send className="h-3 w-3 mr-1" /> Send to Contractor
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
