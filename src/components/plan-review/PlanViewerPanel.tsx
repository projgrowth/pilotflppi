/**
 * Left-side document viewer — empty drop-zone OR rendering progress OR the
 * marked-up plan viewer, plus the file-tabs strip below.
 *
 * Lifted out of PlanReviewDetail. State (file input ref, page images,
 * upload status, repositioning index) lives in the parent and is forwarded
 * here as props.
 */
import { Loader2, Upload, Check } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { PlanMarkupViewer } from "@/components/PlanMarkupViewer";
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
}

export function PlanViewerPanel(props: Props) {
  if (!props.hasDocuments) {
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
            {props.uploading ? "Uploading..." : "Drop plan documents here"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">PDF files up to 20MB</p>
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

  return (
    <>
      {props.renderingPages && props.pageImages.length === 0 && (
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
            return (
              <span
                key={i}
                className="text-2xs text-muted-foreground bg-muted px-2 py-0.5 rounded truncate max-w-[200px]"
              >
                {name}
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
    </>
  );
}
