import { useState, useRef, useEffect, useCallback } from 'react';

export interface UsePanZoomOptions {
  minZoom?: number;
  maxZoom?: number;
  initialZoom?: number;
  initialPan?: { x: number; y: number };
}

export interface UsePanZoomReturn<T extends HTMLElement = HTMLDivElement> {
  zoom: number;
  pan: { x: number; y: number };
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  setPan: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  reset: () => void;
  containerRef: React.RefObject<T>;
  isPanning: boolean;
}

/**
 * Checks if the event target is an interactive element (workstation desk, popover, button, input)
 * where dragging should not initiate pan, allowing clean clicks/taps.
 */
export function isInteractiveElement(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'button, a, input, select, textarea, [role="dialog"], [data-testid="workflow-popover"], [data-testid^="desk-"], [data-no-pan], [data-interactive="true"]'
    )
  );
}

export function usePanZoom<T extends HTMLElement = HTMLDivElement>(
  options: UsePanZoomOptions = {}
): UsePanZoomReturn<T> {
  const {
    minZoom = 0.35,
    maxZoom = 3.0,
    initialZoom = 1.0,
    initialPan = { x: 0, y: 0 },
  } = options;

  const [zoom, setZoomState] = useState<number>(initialZoom);
  const [pan, setPanState] = useState<{ x: number; y: number }>(initialPan);
  const [isPanning, setIsPanning] = useState<boolean>(false);

  const containerRef = useRef<T>(null);
  const zoomRef = useRef<number>(initialZoom);
  const panRef = useRef<{ x: number; y: number }>(initialPan);
  const isPanningRef = useRef<boolean>(false);

  // Synchronize state with refs
  zoomRef.current = zoom;
  panRef.current = pan;
  isPanningRef.current = isPanning;

  // Touch and mouse tracking refs
  const mouseDragRef = useRef<{
    startX: number;
    startY: number;
    initialPan: { x: number; y: number };
    hasMoved: boolean;
  } | null>(null);

  const touchDragRef = useRef<{
    startX: number;
    startY: number;
    initialPan: { x: number; y: number };
    hasMoved: boolean;
  } | null>(null);

  const pinchStartRef = useRef<{
    dist: number;
    mid: { x: number; y: number };
    zoom: number;
    pan: { x: number; y: number };
  } | null>(null);

  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const suppressClickRef = useRef<boolean>(false);

  const reset = useCallback(() => {
    zoomRef.current = initialZoom;
    panRef.current = initialPan;
    setZoomState(initialZoom);
    setPanState(initialPan);
    setIsPanning(false);
  }, [initialZoom, initialPan]);

  const setZoom: React.Dispatch<React.SetStateAction<number>> = useCallback(
    (action) => {
      setZoomState((prev) => {
        const val = typeof action === 'function' ? action(prev) : action;
        const clamped = Math.min(Math.max(val, minZoom), maxZoom);
        zoomRef.current = clamped;
        return clamped;
      });
    },
    [minZoom, maxZoom]
  );

  const setPan: React.Dispatch<React.SetStateAction<{ x: number; y: number }>> = useCallback(
    (action) => {
      setPanState((prev) => {
        const val = typeof action === 'function' ? action(prev) : action;
        panRef.current = val;
        return val;
      });
    },
    []
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Prevent Telegram Mini App / browser viewport rubber-banding
    container.style.touchAction = 'none';

    // 1. Mouse wheel zoom smoothly around pointer coordinates
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      let delta = e.deltaY;
      if (e.deltaMode === 1) delta *= 20;
      else if (e.deltaMode === 2) delta *= 500;

      const currentZoom = zoomRef.current;
      const currentPan = panRef.current;

      const zoomFactor = Math.exp(-delta * 0.0015);
      const nextZoom = Math.min(Math.max(currentZoom * zoomFactor, minZoom), maxZoom);

      if (Math.abs(nextZoom - currentZoom) < 0.0001) return;

      const rect = container.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      const ratio = nextZoom / currentZoom;
      const nextPan = {
        x: currentPan.x + (1 - ratio) * (cx - centerX - currentPan.x),
        y: currentPan.y + (1 - ratio) * (cy - centerY - currentPan.y),
      };

      zoomRef.current = nextZoom;
      panRef.current = nextPan;
      setZoomState(nextZoom);
      setPanState(nextPan);
    };

    // 2. Mouse drag pan (left button)
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (isInteractiveElement(e.target)) return;

      mouseDragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        initialPan: panRef.current,
        hasMoved: false,
      };
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!mouseDragRef.current) return;

      const dx = e.clientX - mouseDragRef.current.startX;
      const dy = e.clientY - mouseDragRef.current.startY;

      if (!mouseDragRef.current.hasMoved) {
        if (Math.hypot(dx, dy) > 4) {
          mouseDragRef.current.hasMoved = true;
          setIsPanning(true);
        }
      }

      if (mouseDragRef.current.hasMoved) {
        e.preventDefault();
        const nextPan = {
          x: mouseDragRef.current.initialPan.x + dx,
          y: mouseDragRef.current.initialPan.y + dy,
        };
        panRef.current = nextPan;
        setPanState(nextPan);
      }
    };

    const handleMouseUp = () => {
      if (mouseDragRef.current?.hasMoved) {
        suppressClickRef.current = true;
        setTimeout(() => {
          suppressClickRef.current = false;
        }, 50);
      }
      mouseDragRef.current = null;
      setIsPanning(false);
    };

    // 3. Multi-touch pinch-to-zoom & single-touch pan
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        // Multi-touch pinch zoom initialization
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const mid = {
          x: (t1.clientX + t2.clientX) / 2,
          y: (t1.clientY + t2.clientY) / 2,
        };

        pinchStartRef.current = {
          dist,
          mid,
          zoom: zoomRef.current,
          pan: panRef.current,
        };
        touchDragRef.current = null;
        setIsPanning(true);
      } else if (e.touches.length === 1) {
        pinchStartRef.current = null;
        const t = e.touches[0];

        // Double-tap reset detection
        const now = Date.now();
        if (
          lastTapRef.current &&
          now - lastTapRef.current.time < 300 &&
          Math.hypot(t.clientX - lastTapRef.current.x, t.clientY - lastTapRef.current.y) < 25 &&
          !isInteractiveElement(e.target)
        ) {
          e.preventDefault();
          reset();
          lastTapRef.current = null;
          touchDragRef.current = null;
          return;
        }
        lastTapRef.current = { time: now, x: t.clientX, y: t.clientY };

        // Single-touch background drag pan
        if (isInteractiveElement(e.target)) {
          touchDragRef.current = null;
          return;
        }

        touchDragRef.current = {
          startX: t.clientX,
          startY: t.clientY,
          initialPan: panRef.current,
          hasMoved: false,
        };
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchStartRef.current) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const currentDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const currentMid = {
          x: (t1.clientX + t2.clientX) / 2,
          y: (t1.clientY + t2.clientY) / 2,
        };

        const { dist: startDist, mid: startMid, zoom: startZoom, pan: startPan } = pinchStartRef.current;
        if (startDist <= 0) return;

        const scaleRatio = currentDist / startDist;
        const nextZoom = Math.min(Math.max(startZoom * scaleRatio, minZoom), maxZoom);

        const rect = container.getBoundingClientRect();
        const cx = currentMid.x - rect.left;
        const cy = currentMid.y - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;

        const dMidX = currentMid.x - startMid.x;
        const dMidY = currentMid.y - startMid.y;

        const ratio = nextZoom / startZoom;
        const nextPan = {
          x: startPan.x + dMidX + (1 - ratio) * (cx - centerX - startPan.x),
          y: startPan.y + dMidY + (1 - ratio) * (cy - centerY - startPan.y),
        };

        zoomRef.current = nextZoom;
        panRef.current = nextPan;
        setZoomState(nextZoom);
        setPanState(nextPan);
        setIsPanning(true);
      } else if (e.touches.length === 1 && touchDragRef.current) {
        const t = e.touches[0];
        const dx = t.clientX - touchDragRef.current.startX;
        const dy = t.clientY - touchDragRef.current.startY;

        if (!touchDragRef.current.hasMoved) {
          if (Math.hypot(dx, dy) > 5) {
            touchDragRef.current.hasMoved = true;
            setIsPanning(true);
          }
        }

        if (touchDragRef.current.hasMoved) {
          e.preventDefault();
          const nextPan = {
            x: touchDragRef.current.initialPan.x + dx,
            y: touchDragRef.current.initialPan.y + dy,
          };
          panRef.current = nextPan;
          setPanState(nextPan);
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (pinchStartRef.current && e.touches.length === 1) {
        // Pinch ended, smoothly transition to single-finger drag with remaining finger
        pinchStartRef.current = null;
        const t = e.touches[0];
        touchDragRef.current = {
          startX: t.clientX,
          startY: t.clientY,
          initialPan: panRef.current,
          hasMoved: true,
        };
        return;
      }

      if (e.touches.length === 0) {
        if (touchDragRef.current?.hasMoved || pinchStartRef.current) {
          suppressClickRef.current = true;
          setTimeout(() => {
            suppressClickRef.current = false;
          }, 50);
        }
        pinchStartRef.current = null;
        touchDragRef.current = null;
        setIsPanning(false);
      }
    };

    // 4. Double click reset
    const handleDblClick = (e: MouseEvent) => {
      if (isInteractiveElement(e.target)) return;
      e.preventDefault();
      reset();
    };

    // 5. Suppress click after drag
    const handleClickCapture = (e: MouseEvent) => {
      if (suppressClickRef.current) {
        e.stopPropagation();
        e.preventDefault();
        suppressClickRef.current = false;
      }
    };

    // Attach listeners
    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);
    container.addEventListener('touchcancel', handleTouchEnd);
    container.addEventListener('dblclick', handleDblClick);
    container.addEventListener('click', handleClickCapture, true);

    return () => {
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
      container.removeEventListener('dblclick', handleDblClick);
      container.removeEventListener('click', handleClickCapture, true);
    };
  }, [minZoom, maxZoom, reset]);

  return {
    zoom,
    pan,
    setZoom,
    setPan,
    reset,
    containerRef,
    isPanning,
  };
}
