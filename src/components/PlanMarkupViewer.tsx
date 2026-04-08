import { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Finding } from "@/components/FindingCard";

interface Annotation {
  x: number; // percentage 0-100
  y: number;
  width: number;
  height: number;
}

interface MarkupProps {
  pageImages: { pageIndex: number; base64: string }[];
  findings: Finding[];
  activeFindingIndex: number | null;
  onAnnotationClick: (findingIndex: number) => void;
  className?: string;
}

export function PlanMarkupViewer({
  pageImages,
  findings,
  activeFindingIndex,
  onAnnotationClick,
  className,
}: MarkupProps) {
  const [currentPage, setCurrentPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const annotationRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Get findings for the current page
  const pageFindings = findings
    .map((f, i) => ({ finding: f, globalIndex: i }))
    .filter((item) => item.finding.markup?.page_index === currentPage);

  // When activeFindingIndex changes, navigate to its page and pulse
  useEffect(() => {
    if (activeFindingIndex === null) return;
    const f = findings[activeFindingIndex];
    if (!f?.markup) return;
    if (f.markup.page_index !== currentPage) {
      setCurrentPage(f.markup.page_index);
    }
    // Scroll the annotation into view
    setTimeout(() => {
      const el = annotationRefs.current.get(activeFindingIndex);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  }, [activeFindingIndex]);

  const setAnnotationRef = useCallback((index: number, el: HTMLDivElement | null) => {
    if (el) annotationRefs.current.set(index, el);
    else annotationRefs.current.delete(index);
  }, []);

  if (pageImages.length === 0) {
    return (
      <div className={cn("flex items-center justify-center h-full bg-muted/20 rounded-lg border", className)}>
        <p className="text-sm text-muted-foreground">No document pages to display</p>
      </div>
    );
  }

  const currentImage = pageImages[currentPage];

  return (
    <div className={cn("flex flex-col h-full border rounded-lg overflow-hidden bg-muted/10", className)}>
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b bg-card px-3 py-1.5 shrink-0">
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            disabled={currentPage === 0}
            onClick={() => setCurrentPage((p) => p - 1)}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs font-medium text-muted-foreground min-w-[60px] text-center">
            {currentPage + 1} / {pageImages.length}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            disabled={currentPage === pageImages.length - 1}
            onClick={() => setCurrentPage((p) => p + 1)}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <span className="text-[10px] font-medium text-muted-foreground w-10 text-center">{Math.round(zoom * 100)}%</span>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Canvas area */}
      <div ref={containerRef} className="flex-1 overflow-auto relative">
        <div className="relative inline-block" style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}>
          {currentImage && (
            <img
              src={currentImage.base64}
              alt={`Plan page ${currentPage + 1}`}
              className="block max-w-none"
              draggable={false}
            />
          )}

          {/* Annotation overlays */}
          {pageFindings.map(({ finding, globalIndex }) => {
            if (!finding.markup) return null;
            const annots = finding.markup.annotations || [{ x: finding.markup.x || 0, y: finding.markup.y || 0, width: finding.markup.width || 10, height: finding.markup.height || 5 }];
            return annots.map((a: Annotation, ai: number) => {
              const isActive = activeFindingIndex === globalIndex;
              return (
                <div
                  key={`${globalIndex}-${ai}`}
                  ref={(el) => ai === 0 ? setAnnotationRef(globalIndex, el) : undefined}
                  className={cn(
                    "absolute border-2 cursor-pointer transition-all duration-300",
                    isActive
                      ? "border-destructive bg-destructive/20 shadow-[0_0_12px_rgba(220,38,38,0.4)] animate-pulse"
                      : "border-destructive/60 bg-destructive/10 hover:bg-destructive/20"
                  )}
                  style={{
                    left: `${a.x}%`,
                    top: `${a.y}%`,
                    width: `${a.width}%`,
                    height: `${a.height}%`,
                  }}
                  onClick={() => onAnnotationClick(globalIndex)}
                >
                  {/* Callout badge */}
                  <div className={cn(
                    "absolute -top-3 -left-3 h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold shadow-md",
                    isActive
                      ? "bg-destructive text-destructive-foreground"
                      : "bg-destructive/80 text-destructive-foreground"
                  )}>
                    {globalIndex + 1}
                  </div>
                </div>
              );
            });
          })}
        </div>
      </div>
    </div>
  );
}
