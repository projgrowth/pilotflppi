import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut,
  Maximize, Columns, PanelLeftClose, PanelLeft,
  Keyboard, Check, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Finding } from "@/components/FindingCard";

interface Annotation {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface MarkupProps {
  pageImages: { pageIndex: number; base64: string }[];
  findings: Finding[];
  activeFindingIndex: number | null;
  onAnnotationClick: (findingIndex: number) => void;
  /** When set, viewer enters reposition mode for this finding. Click on the page to set new pin location. */
  repositioningIndex?: number | null;
  onRepositionConfirm?: (index: number, markup: { page_index: number; x: number; y: number; width: number; height: number }) => void;
  onRepositionCancel?: () => void;
  className?: string;
}

const ZOOM_PRESETS = [0.5, 0.75, 1, 1.5, 2];

/** Treat any annotation ≤ 4×4 percent as a pin (point issue) rather than a region. */
function isPinSize(a: Annotation): boolean {
  return a.width <= 4 && a.height <= 4;
}

export function PlanMarkupViewer({
  pageImages,
  findings,
  activeFindingIndex,
  onAnnotationClick,
  repositioningIndex,
  onRepositionConfirm,
  onRepositionCancel,
  className,
}: MarkupProps) {
  const [currentPage, setCurrentPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [showThumbnails, setShowThumbnails] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const annotationRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Drag-to-pan state
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  // Reposition draft (where user clicked, before confirming)
  const [draftPin, setDraftPin] = useState<{ x: number; y: number } | null>(null);
  const isRepositioning = repositioningIndex !== null && repositioningIndex !== undefined;

  // Reset draft when reposition target changes / clears
  useEffect(() => { setDraftPin(null); }, [repositioningIndex]);

  // When entering reposition mode, jump to the finding's current page so user has context
  useEffect(() => {
    if (!isRepositioning) return;
    const f = findings[repositioningIndex!];
    if (f?.markup && typeof f.markup.page_index === "number") {
      setCurrentPage(f.markup.page_index);
    }
  }, [isRepositioning, repositioningIndex, findings]);

  const pageFindings = useMemo(() =>
    findings
      .map((f, i) => ({ finding: f, globalIndex: i }))
      .filter((item) => item.finding.markup?.page_index === currentPage),
    [findings, currentPage]
  );

  // Navigate to active finding's page
  useEffect(() => {
    if (activeFindingIndex === null) return;
    const f = findings[activeFindingIndex];
    if (!f?.markup) return;
    if (f.markup.page_index !== currentPage) {
      setCurrentPage(f.markup.page_index);
    }
    setTimeout(() => {
      const el = annotationRefs.current.get(activeFindingIndex);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  }, [activeFindingIndex]);

  const setAnnotationRef = useCallback((index: number, el: HTMLDivElement | null) => {
    if (el) annotationRefs.current.set(index, el);
    else annotationRefs.current.delete(index);
  }, []);

  // Fit width / fit page
  const fitWidth = useCallback(() => {
    const container = containerRef.current;
    const img = imageRef.current;
    if (!container || !img || !img.naturalWidth) return;
    const available = container.clientWidth - (showThumbnails ? 0 : 0);
    setZoom(available / img.naturalWidth);
  }, [showThumbnails]);

  const fitPage = useCallback(() => {
    const container = containerRef.current;
    const img = imageRef.current;
    if (!container || !img || !img.naturalWidth) return;
    const zw = container.clientWidth / img.naturalWidth;
    const zh = container.clientHeight / img.naturalHeight;
    setZoom(Math.min(zw, zh) * 0.95);
  }, []);

  // Scroll-wheel zoom (Ctrl+scroll or pinch)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom((z) => Math.min(3, Math.max(0.25, z + delta)));
    };
    container.addEventListener("wheel", handler, { passive: false });
    return () => container.removeEventListener("wheel", handler);
  }, []);

  // Drag-to-pan handlers (disabled in reposition mode)
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (isRepositioning) return;
    if ((e.target as HTMLElement).closest("[data-annotation]")) return;
    const container = containerRef.current;
    if (!container) return;
    setIsPanning(true);
    panStart.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop,
    };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, [isRepositioning]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanning) return;
    const container = containerRef.current;
    if (!container) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    container.scrollLeft = panStart.current.scrollLeft - dx;
    container.scrollTop = panStart.current.scrollTop - dy;
  }, [isPanning]);

  const onPointerUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  // Click handler for reposition mode
  const onCanvasClick = useCallback((e: React.MouseEvent) => {
    if (!isRepositioning) return;
    const img = imageRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    if (x < 0 || x > 100 || y < 0 || y > 100) return;
    setDraftPin({ x, y });
  }, [isRepositioning]);

  const confirmReposition = () => {
    if (!isRepositioning || !draftPin || !onRepositionConfirm) return;
    // Convert click point to a 3% × 3% pin centered on the click.
    onRepositionConfirm(repositioningIndex!, {
      page_index: currentPage,
      x: Math.max(0, draftPin.x - 1.5),
      y: Math.max(0, draftPin.y - 1.5),
      width: 3,
      height: 3,
    });
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") return;
      if (isRepositioning && e.key === "Escape") { onRepositionCancel?.(); return; }
      if (isRepositioning && e.key === "Enter" && draftPin) { confirmReposition(); return; }

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          setCurrentPage((p) => Math.max(0, p - 1));
          break;
        case "ArrowRight":
          e.preventDefault();
          setCurrentPage((p) => Math.min(pageImages.length - 1, p + 1));
          break;
        case "+":
        case "=":
          e.preventDefault();
          setZoom((z) => Math.min(3, z + 0.25));
          break;
        case "-":
          e.preventDefault();
          setZoom((z) => Math.max(0.25, z - 0.25));
          break;
        case "0":
          e.preventDefault();
          fitWidth();
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pageImages.length, fitWidth, isRepositioning, draftPin, onRepositionCancel]);

  if (pageImages.length === 0) {
    return (
      <div className={cn("flex items-center justify-center h-full bg-muted/20 rounded-lg border", className)}>
        <p className="text-sm text-muted-foreground">No document pages to display</p>
      </div>
    );
  }

  const currentImage = pageImages[currentPage];

  return (
    <div className={cn("flex flex-col h-full overflow-hidden bg-muted/10", className)}>
      {/* Reposition banner */}
      {isRepositioning && (
        <div className="shrink-0 bg-accent/10 border-b border-accent/30 px-3 py-1.5 flex items-center gap-2">
          <span className="text-xs font-medium text-accent">
            Reposition pin for finding #{repositioningIndex! + 1}
          </span>
          <span className="text-2xs text-muted-foreground">
            Click anywhere on the sheet to set the new location · Esc to cancel · Enter to save
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-6 px-2 text-2xs" onClick={onRepositionCancel}>
              <X className="h-3 w-3 mr-1" /> Cancel
            </Button>
            <Button
              size="sm"
              className="h-6 px-2 text-2xs bg-accent text-accent-foreground"
              disabled={!draftPin}
              onClick={confirmReposition}
            >
              <Check className="h-3 w-3 mr-1" /> Save pin
            </Button>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between border-b bg-card px-3 py-1.5 shrink-0 gap-2">
        {/* Left: page nav */}
        <div className="flex items-center gap-1">
          <Button
            size="icon" variant="ghost" className="h-7 w-7"
            onClick={() => setShowThumbnails(!showThumbnails)}
            title="Toggle thumbnails"
          >
            {showThumbnails ? <PanelLeftClose className="h-3.5 w-3.5" /> : <PanelLeft className="h-3.5 w-3.5" />}
          </Button>
          <div className="w-px h-4 bg-border mx-1" />
          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={currentPage === 0} onClick={() => setCurrentPage((p) => p - 1)}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs font-medium text-muted-foreground min-w-[60px] text-center">
            {currentPage + 1} / {pageImages.length}
          </span>
          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={currentPage === pageImages.length - 1} onClick={() => setCurrentPage((p) => p + 1)}>
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Center: zoom presets */}
        <div className="flex items-center gap-0.5">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}>
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          {ZOOM_PRESETS.map((preset) => (
            <button
              key={preset}
              onClick={() => setZoom(preset)}
              className={cn(
                "px-1.5 py-0.5 rounded text-2xs font-medium transition-colors",
                Math.abs(zoom - preset) < 0.05
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              {Math.round(preset * 100)}%
            </button>
          ))}
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Right: fit controls + shortcuts hint */}
        <div className="flex items-center gap-1">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={fitWidth}>
                  <Columns className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-2xs">Fit Width (0)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={fitPage}>
                  <Maximize className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-2xs">Fit Page</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="h-7 w-7 flex items-center justify-center text-muted-foreground/40">
                  <Keyboard className="h-3.5 w-3.5" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-2xs space-y-0.5">
                <p>← → Page nav</p>
                <p>+ / − Zoom</p>
                <p>0 Fit width</p>
                <p>Ctrl+Scroll Zoom</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Main area with optional thumbnails */}
      <div className="flex-1 flex overflow-hidden">
        {/* Thumbnail strip */}
        {showThumbnails && pageImages.length > 1 && (
          <div className="w-20 shrink-0 border-r bg-card overflow-y-auto p-1.5 space-y-1.5">
            {pageImages.map((img, idx) => (
              <button
                key={idx}
                onClick={() => setCurrentPage(idx)}
                className={cn(
                  "w-full rounded border overflow-hidden transition-all",
                  idx === currentPage
                    ? "border-accent ring-1 ring-accent/40 shadow-sm"
                    : "border-border/40 hover:border-border opacity-60 hover:opacity-100"
                )}
              >
                <img
                  src={img.base64}
                  alt={`Page ${idx + 1}`}
                  className="w-full h-auto block"
                  draggable={false}
                />
                <div className="text-caption text-muted-foreground text-center py-0.5 bg-muted/30">
                  {idx + 1}
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Canvas area */}
        <div
          ref={containerRef}
          className={cn(
            "flex-1 overflow-auto relative",
            isRepositioning ? "cursor-crosshair" : isPanning ? "cursor-grabbing" : "cursor-grab"
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onClick={onCanvasClick}
        >
          <div
            className="relative inline-block"
            style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
          >
            {currentImage && (
              <img
                ref={imageRef}
                src={currentImage.base64}
                alt={`Plan page ${currentPage + 1}`}
                className="block max-w-none select-none"
                draggable={false}
                onLoad={() => {
                  if (zoom === 1 && imageRef.current && containerRef.current) {
                    const available = containerRef.current.clientWidth;
                    const natural = imageRef.current.naturalWidth;
                    if (natural > available) {
                      setZoom(available / natural);
                    }
                  }
                }}
              />
            )}

            {/* Annotation overlays */}
            {pageFindings.map(({ finding, globalIndex }) => {
              if (!finding.markup) return null;
              // Skip drawing the existing pin for the finding being repositioned
              if (isRepositioning && globalIndex === repositioningIndex) return null;
              const annots = finding.markup.annotations || [
                {
                  x: finding.markup.x || 0,
                  y: finding.markup.y || 0,
                  width: finding.markup.width || 4,
                  height: finding.markup.height || 4,
                },
              ];
              return annots.map((a: Annotation, ai: number) => {
                const isActive = activeFindingIndex === globalIndex;
                const pin = isPinSize(a);
                const sheetLabel = finding.page && finding.page !== "Unknown" ? finding.page : null;
                const badgeText = sheetLabel ? `${sheetLabel} · #${globalIndex + 1}` : `#${globalIndex + 1}`;

                if (pin) {
                  // Crosshair pin: render at the CENTER of the (small) box
                  const cx = a.x + a.width / 2;
                  const cy = a.y + a.height / 2;
                  return (
                    <div
                      key={`${globalIndex}-${ai}`}
                      data-annotation
                      ref={(el) => (ai === 0 ? setAnnotationRef(globalIndex, el) : undefined)}
                      className="absolute pointer-events-auto cursor-pointer"
                      style={{
                        left: `${cx}%`,
                        top: `${cy}%`,
                        transform: "translate(-50%, -50%)",
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onAnnotationClick(globalIndex);
                      }}
                    >
                      {/* Crosshair: outer circle + inner dot + cross lines */}
                      <div className={cn(
                        "relative rounded-full border-2 transition-all",
                        isActive
                          ? "h-7 w-7 border-destructive bg-destructive/20 shadow-[0_0_12px_hsl(var(--destructive)/0.5)]"
                          : "h-5 w-5 border-destructive/70 bg-destructive/10 hover:border-destructive hover:bg-destructive/20"
                      )}>
                        {/* center dot */}
                        <div className={cn(
                          "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-destructive",
                          isActive ? "h-2 w-2" : "h-1.5 w-1.5"
                        )} />
                        {/* cross lines */}
                        <div className="absolute top-1/2 left-0 right-0 h-px bg-destructive/60 -translate-y-1/2" />
                        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-destructive/60 -translate-x-1/2" />
                      </div>
                      {/* Badge to the right of the pin */}
                      <div className={cn(
                        "absolute left-full ml-1 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-2xs font-bold whitespace-nowrap shadow-md",
                        isActive
                          ? "bg-destructive text-destructive-foreground"
                          : "bg-destructive/85 text-destructive-foreground"
                      )}>
                        {badgeText}
                      </div>
                    </div>
                  );
                }

                // Region box (for findings that span an area)
                return (
                  <div
                    key={`${globalIndex}-${ai}`}
                    data-annotation
                    ref={(el) => (ai === 0 ? setAnnotationRef(globalIndex, el) : undefined)}
                    className={cn(
                      "absolute border-2 cursor-pointer transition-all duration-300",
                      isActive
                        ? "border-destructive bg-destructive/20 shadow-[0_0_12px_hsl(var(--destructive)/0.4)] animate-pulse"
                        : "border-destructive/60 bg-destructive/10 hover:bg-destructive/20"
                    )}
                    style={{
                      left: `${a.x}%`,
                      top: `${a.y}%`,
                      width: `${a.width}%`,
                      height: `${a.height}%`,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAnnotationClick(globalIndex);
                    }}
                  >
                    <div
                      className={cn(
                        "absolute -top-3 -left-1 px-1.5 py-0.5 rounded text-2xs font-bold whitespace-nowrap shadow-md",
                        isActive
                          ? "bg-destructive text-destructive-foreground"
                          : "bg-destructive/85 text-destructive-foreground"
                      )}
                    >
                      {badgeText}
                    </div>
                  </div>
                );
              });
            })}

            {/* Reposition draft pin */}
            {isRepositioning && draftPin && (
              <div
                className="absolute pointer-events-none"
                style={{
                  left: `${draftPin.x}%`,
                  top: `${draftPin.y}%`,
                  transform: "translate(-50%, -50%)",
                }}
              >
                <div className="relative h-8 w-8 rounded-full border-2 border-accent bg-accent/30 shadow-[0_0_16px_hsl(var(--accent)/0.6)] animate-pulse">
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full bg-accent" />
                  <div className="absolute top-1/2 left-0 right-0 h-px bg-accent/70 -translate-y-1/2" />
                  <div className="absolute left-1/2 top-0 bottom-0 w-px bg-accent/70 -translate-x-1/2" />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
