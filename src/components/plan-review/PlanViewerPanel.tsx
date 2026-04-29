/**
 * Left-side document viewer — empty drop-zone OR rendering progress OR the
 * marked-up plan viewer, plus the file-tabs strip below.
 *
 * Lifted out of PlanReviewDetail. State (file input ref, page images,
 * upload status, repositioning index) lives in the parent and is forwarded
 * here as props.
 */
import { Loader2, Upload, Check, X } from "lucide-react";
import { useState } from "react";
import { Progress } from "@/components/ui/progress";
import { PlanMarkupViewer } from "@/components/PlanMarkupViewer";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { ProcessingOverlay } from "@/components/plan-review/ProcessingOverlay";
import { deletePlanReviewFile } from "@/lib/delete-plan-review-file";
import { toast } from "sonner";
import type { PDFPageImage } from "@/lib/pdf-utils";
import type { Finding } from "@/components/FindingCard";

interface Props {
  hasDocuments: boolean;
  fileUrls: string[];
  pageImages: PDFPageImage[];
  renderingPages: boolean;
  renderProgress: number;
  uploading: boolean;
  uploadSuccess: boolean;
  /**
   * When true and the document set has been uploaded but the AI pipeline hasn't
   * finished yet, render the full-canvas ProcessingOverlay instead of a tiny
   * "Loading document…" spinner. Drives the "I can see what's happening" UX.
   */
  pipelineProcessing?: boolean;
  /** Sub-phase to render in the overlay before the pipeline starts. */
  processingPhase?: import("./ProcessingOverlay").ProcessingPhase;
  preparedPages?: number;
  expectedPages?: number;
  pendingFileCount?: number;
  onPipelineComplete?: () => void;
  onOpenDashboard?: () => void;

  findings: Finding[];
  activeFindingIndex: number | null;
  onAnnotationClick: (index: number) => void;

  // Reposition (desktop only)
  repositioningIndex?: number | null;
  onRepositionConfirm?: (
    idx: number,
    newMarkup: { page_index: number; x: number; y: number; width: number; height: number },
  ) => void;
  onRepositionCancel?: () => void;

  fileInputRef: React.RefObject<HTMLInputElement>;
  onFileUpload: (files: FileList | null) => void;
  showFileTabs?: boolean;
  /** Plan review id — when present, file chips become deletable. */
  planReviewId?: string;
  /** Refresh callback after a file is deleted. */
  onFileDeleted?: () => void;
}

export function PlanViewerPanel(props: Props) {
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleConfirmDelete = async () => {
    if (!pendingDelete || !props.planReviewId) return;
    setDeleting(true);
    const result = await deletePlanReviewFile({
      planReviewId: props.planReviewId,
      filePath: pendingDelete,
    });
    setDeleting(false);
    if (result.ok) {
      toast.success("File removed");
      setPendingDelete(null);
      props.onFileDeleted?.();
    } else {
      toast.error(result.blocker ?? "Could not delete file");
    }
  };

  // Bootstrapping: review was just created, files are uploading via background
  // task. Don't show the empty drop zone — show the processing overlay so the
  // user sees continuous motion from the moment they hit Create Project.
  const isBootstrapping = !!props.pipelineProcessing && !!props.planReviewId;

  if (!props.hasDocuments && !isBootstrapping) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div
          className="border-2 border-dashed border-border/50 rounded-xl p-12 text-center cursor-pointer hover:border-accent/40 hover:bg-accent/5 transition-all max-w-md"
          onClick={() => props.fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            props.onFileUpload(e.dataTransfer.files);
          }}
        >
          {props.uploading ? (
            <Loader2 className="h-10 w-10 text-accent mx-auto mb-3 animate-spin" />
          ) : (
            <Upload className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          )}
          <p className="text-sm font-medium text-foreground">
            {props.uploading ? "Uploading…" : "Drop the full plan set (PDF)"}
          </p>
          <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
            Include the cover, code summary, and all discipline sheets.<br />
            We auto-detect Architectural, Structural, MEP, Civil &amp; Fire Protection.
          </p>
          <p className="text-2xs text-muted-foreground/70 mt-2">PDF up to 50&nbsp;MB</p>
          <input
            ref={props.fileInputRef}
            type="file"
            accept=".pdf"
            multiple
            className="hidden"
            onChange={(e) => props.onFileUpload(e.target.files)}
          />
        </div>
      </div>
    );
  }

  // While the AI pipeline is still working AND we don't yet have rendered
  // pages to show, take over the canvas with the live progress overlay
  // instead of stranding the user on a blank "Loading document…" spinner.
  const showProcessing =
    !!props.pipelineProcessing && props.pageImages.length === 0 && !!props.planReviewId;

  return (
    <>
      {showProcessing && (
        <ProcessingOverlay
          planReviewId={props.planReviewId!}
          phase={props.processingPhase ?? "analyzing"}
          preparedPages={props.preparedPages}
          expectedPages={props.expectedPages}
          fileCount={props.pendingFileCount}
          onComplete={props.onPipelineComplete}
          onOpenDashboard={props.onOpenDashboard}
        />
      )}
      {!showProcessing && props.renderingPages && props.pageImages.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <Loader2 className="h-8 w-8 text-accent mx-auto animate-spin" />
            <p className="text-sm text-muted-foreground">Loading document...</p>
            <Progress value={props.renderProgress} className="h-1 w-48 mx-auto" />
          </div>
        </div>
      )}
      {props.pageImages.length > 0 && (
        <PlanMarkupViewer
          pageImages={props.pageImages}
          findings={props.findings}
          activeFindingIndex={props.activeFindingIndex}
          onAnnotationClick={props.onAnnotationClick}
          repositioningIndex={props.repositioningIndex}
          onRepositionConfirm={props.onRepositionConfirm}
          onRepositionCancel={props.onRepositionCancel}
          className="flex-1"
        />
      )}
      {props.showFileTabs && (
        <div className="shrink-0 border-t bg-muted/20 px-3 py-1.5 flex items-center gap-2 overflow-x-auto">
          {props.uploadSuccess && (
            <span className="flex items-center gap-1 text-2xs text-success font-medium animate-in fade-in">
              <Check className="h-3 w-3" /> Uploaded
            </span>
          )}
          {props.fileUrls.map((url, i) => {
            const name = decodeURIComponent(url.split("/").pop() || `Doc ${i + 1}`);
            const canDelete = !!props.planReviewId;
            return (
              <span
                key={i}
                className="group inline-flex items-center gap-1 text-2xs text-muted-foreground bg-muted px-2 py-0.5 rounded max-w-[240px]"
              >
                <span className="truncate">{name}</span>
                {canDelete && (
                  <button
                    type="button"
                    aria-label={`Remove ${name}`}
                    onClick={() => setPendingDelete(url)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive shrink-0"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            );
          })}
          <button
            className="text-2xs text-accent hover:text-accent/80 transition-colors shrink-0"
            onClick={() => props.fileInputRef.current?.click()}
          >
            + Add file
          </button>
          <input
            ref={props.fileInputRef}
            type="file"
            accept=".pdf"
            multiple
            className="hidden"
            onChange={(e) => props.onFileUpload(e.target.files)}
          />
        </div>
      )}
      {pendingDelete && (
        <DeleteConfirmDialog
          open={!!pendingDelete}
          onOpenChange={(o) => !o && setPendingDelete(null)}
          resourceLabel="file"
          expectedConfirmText={decodeURIComponent(pendingDelete.split("/").pop() || "file")}
          title="Remove this file?"
          description="The PDF will be removed from this review and from storage. Page renderings stay until the review is re-prepared. Sent letters block deletion."
          loading={deleting}
          onConfirm={handleConfirmDelete}
        />
      )}
    </>
  );
}
