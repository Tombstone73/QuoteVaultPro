import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { FileText, Plus, Minus } from "lucide-react";

type ViewMode = "fit" | "100" | "custom";

interface ZoomPanImageViewerProps {
  src: string | null;
  alt?: string;
  className?: string;
}

/**
 * ZoomPanImageViewer - Reusable image viewer with fit/100%/zoom modes and pan capability
 * 
 * Features:
 * - Fit: Auto-scales image to fit container (object-contain behavior)
 * - 100%: Shows image at native resolution (1:1 scale)
 * - Custom zoom: Mouse wheel zoom 0.25x-5x with pan/drag capability
 * - Hand cursor for panning when zoomed
 * - Double-click toggles between fit and zoom
 * - Persists mode choice in localStorage
 */
export default function ZoomPanImageViewer({ src, alt = "Image", className = "" }: ZoomPanImageViewerProps) {
  const [mode, setMode] = useState<ViewMode>(() => {
    const stored = localStorage.getItem("artworkViewerMode");
    return (stored === "fit" || stored === "100" || stored === "custom") ? stored : "fit";
  });
  const [customScale, setCustomScale] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const MIN_SCALE = 0.25;
  const MAX_SCALE = 5;

  // Update localStorage when mode changes
  useEffect(() => {
    localStorage.setItem("artworkViewerMode", mode);
  }, [mode]);

  // Reset states when src changes
  useEffect(() => {
    setImageLoaded(false);
    setImageFailed(false);
    setOffsetX(0);
    setOffsetY(0);
    setNaturalSize({ width: 0, height: 0 });
  }, [src]);

  // Reset offsets when mode changes
  useEffect(() => {
    setOffsetX(0);
    setOffsetY(0);
  }, [mode]);

  // Measure viewport size with ResizeObserver
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setViewportSize({ width, height });
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Handle image load
  const handleImageLoad = useCallback(() => {
    if (!imageRef.current) return;
    const { naturalWidth, naturalHeight } = imageRef.current;
    setNaturalSize({ width: naturalWidth, height: naturalHeight });
    setImageLoaded(true);
    setImageFailed(false);
  }, []);

  // Handle image error
  const handleImageError = useCallback(() => {
    setImageFailed(true);
    setImageLoaded(false);
  }, []);

  // Calculate scale based on mode (helper function for reuse)
  const calculateScale = useCallback(() => {
    if (!imageLoaded || naturalSize.width === 0 || naturalSize.height === 0 || viewportSize.width === 0 || viewportSize.height === 0) {
      return 1;
    }

    if (mode === "custom") {
      return customScale;
    } else if (mode === "fit") {
      // Auto-fit to container
      const scaleX = viewportSize.width / naturalSize.width;
      const scaleY = viewportSize.height / naturalSize.height;
      return Math.min(scaleX, scaleY, 1); // Never scale up beyond 1:1
    } else if (mode === "100") {
      return 1;
    }
    return 1;
  }, [mode, customScale, viewportSize, naturalSize, imageLoaded]);

  // Memoized scale for rendering
  const scale = calculateScale();

  // Handle mouse wheel zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !imageLoaded) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Calculate zoom delta
      const delta = -e.deltaY;
      const zoomSpeed = 0.001;
      const zoomFactor = 1 + delta * zoomSpeed;

      // Get current scale dynamically
      const currentScale = calculateScale();
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, currentScale * zoomFactor));

      // If scale changed, switch to custom mode
      if (newScale !== currentScale) {
        setMode("custom");
        setCustomScale(newScale);

        // Get cursor position relative to container
        const rect = container.getBoundingClientRect();
        const cursorX = e.clientX - rect.left;
        const cursorY = e.clientY - rect.top;

        // Calculate new offsets to zoom towards cursor
        const scaleRatio = newScale / currentScale;
        const newOffsetX = cursorX - (cursorX - offsetX) * scaleRatio - (viewportSize.width / 2 - cursorX) * (scaleRatio - 1);
        const newOffsetY = cursorY - (cursorY - offsetY) * scaleRatio - (viewportSize.height / 2 - cursorY) * (scaleRatio - 1);

        // Clamp offsets
        const scaledWidth = naturalSize.width * newScale;
        const scaledHeight = naturalSize.height * newScale;
        const maxOffX = Math.max(0, (scaledWidth - viewportSize.width) / 2);
        const maxOffY = Math.max(0, (scaledHeight - viewportSize.height) / 2);

        setOffsetX(Math.max(-maxOffX, Math.min(maxOffX, newOffsetX)));
        setOffsetY(Math.max(-maxOffY, Math.min(maxOffY, newOffsetY)));
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [imageLoaded, calculateScale, offsetX, offsetY, naturalSize, viewportSize]);

  // Calculate scaled image dimensions
  const scaledWidth = naturalSize.width * scale;
  const scaledHeight = naturalSize.height * scale;

  // Calculate max offsets to prevent dragging image completely off-screen
  const maxOffsetX = Math.max(0, (scaledWidth - viewportSize.width) / 2);
  const maxOffsetY = Math.max(0, (scaledHeight - viewportSize.height) / 2);

  // Clamp offset function
  const clampOffset = useCallback((x: number, y: number) => {
    return {
      x: Math.max(-maxOffsetX, Math.min(maxOffsetX, x)),
      y: Math.max(-maxOffsetY, Math.min(maxOffsetY, y)),
    };
  }, [maxOffsetX, maxOffsetY]);

  // Pointer event handlers for panning
  const handlePointerDown = (e: React.PointerEvent) => {
    if (scale <= 1 || !imageLoaded) return; // Only allow panning when zoomed
    
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    setDragStart({ x: e.clientX - offsetX, y: e.clientY - offsetY });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;

    const newX = e.clientX - dragStart.x;
    const newY = e.clientY - dragStart.y;
    const clamped = clampOffset(newX, newY);
    setOffsetX(clamped.x);
    setOffsetY(clamped.y);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setIsDragging(false);
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    if (!isDragging) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setIsDragging(false);
  };

  // Double-click toggles between fit and custom zoom
  const handleDoubleClick = () => {
    if (mode === "fit" || mode === "100") {
      setMode("custom");
      setCustomScale(2);
    } else {
      setMode("fit");
    }
  };

  // Zoom helper functions
  const handleZoomIn = () => {
    const newScale = Math.min(MAX_SCALE, scale * 1.2);
    setMode("custom");
    setCustomScale(newScale);
  };

  const handleZoomOut = () => {
    const newScale = Math.max(MIN_SCALE, scale / 1.2);
    setMode("custom");
    setCustomScale(newScale);
  };

  // Cursor style
  const cursorStyle = scale > 1 && imageLoaded
    ? isDragging
      ? "cursor-grabbing"
      : "cursor-grab"
    : "cursor-default";

  // Render fallback if no src or load failed
  if (!src || imageFailed) {
    return (
      <div className={`flex items-center justify-center bg-muted ${className}`}>
        <div className="text-center p-4">
          <FileText className="mx-auto h-12 w-12 text-muted-foreground" />
          <div className="mt-2 text-sm text-muted-foreground">No Preview Available</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative flex flex-col ${className}`}>
      {/* Mode controls */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1 bg-background/90 backdrop-blur-sm rounded-md shadow-md p-1">
        <Button
          size="sm"
          variant={mode === "fit" ? "default" : "ghost"}
          onClick={() => setMode("fit")}
          className="h-7 px-2 text-xs"
        >
          Fit
        </Button>
        <Button
          size="sm"
          variant={mode === "100" ? "default" : "ghost"}
          onClick={() => setMode("100")}
          className="h-7 px-2 text-xs"
        >
          100%
        </Button>
        <div className="h-5 w-px bg-border mx-1" />
        <Button
          size="sm"
          variant="ghost"
          onClick={handleZoomOut}
          disabled={scale <= MIN_SCALE}
          className="h-7 w-7 p-0"
          title="Zoom Out"
        >
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleZoomIn}
          disabled={scale >= MAX_SCALE}
          className="h-7 w-7 p-0"
          title="Zoom In"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <span className="text-xs text-muted-foreground px-2">{Math.round(scale * 100)}%</span>
      </div>

      {/* Image viewport */}
      <div
        ref={containerRef}
        className={`relative flex-1 overflow-hidden bg-muted flex items-center justify-center ${cursorStyle}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onDoubleClick={handleDoubleClick}
        style={{ touchAction: "none" }}
      >
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          onLoad={handleImageLoad}
          onError={handleImageError}
          draggable={false}
          style={{
            transform: `scale(${scale}) translate(${offsetX / scale}px, ${offsetY / scale}px)`,
            transition: isDragging ? "none" : "transform 0.2s ease-out",
            transformOrigin: "center center",
            maxWidth: mode === "fit" ? "100%" : "none",
            maxHeight: mode === "fit" ? "100%" : "none",
            width: mode === "fit" ? "auto" : `${naturalSize.width}px`,
            height: mode === "fit" ? "auto" : `${naturalSize.height}px`,
            userSelect: "none",
          }}
        />
      </div>

      {/* Optional: Show current scale */}
      {imageLoaded && mode !== "fit" && (
        <div className="absolute bottom-3 left-3 z-10 bg-background/90 backdrop-blur-sm rounded-md shadow-md px-2 py-1 text-xs text-muted-foreground">
          {Math.round(scale * 100)}%
        </div>
      )}
    </div>
  );
}
