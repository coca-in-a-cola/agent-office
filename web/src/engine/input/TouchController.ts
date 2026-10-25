/**
 * Touch and Pointer Controller for Agent Office Tycoon Canvas.
 * Supports:
 * - Single-finger / pointer panning with a 6px deadzone (prevents eating taps).
 * - Two-finger pinch-to-zoom with focal point tracking around touch midpoint.
 * - Zoom clamped to [minScale, maxScale] (default [0.4, 2.5]).
 * - Mouse wheel zoom centered on cursor + click-and-drag panning.
 * - Clean tap detection (< 6px movement, < 300ms duration).
 * - Telegram WebApp viewportChanged listener without zoom reset.
 * - Automatic touch-action: none enforcement.
 */

export interface TransformState {
  x: number;
  y: number;
  scale: number;
}

export interface TapEvent {
  screenX: number;
  screenY: number;
}

export interface TouchControllerOptions {
  minScale?: number;
  maxScale?: number;
  dragThreshold?: number;
  onTransform?: (transform: TransformState) => void;
  onTap?: (tap: TapEvent) => void;
}

interface PointerTracker {
  id: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  startTime: number;
}

export class TouchController {
  private element: HTMLElement | null = null;
  private minScale: number;
  private maxScale: number;
  private dragThreshold: number;
  private onTransform?: (transform: TransformState) => void;
  private onTap?: (tap: TapEvent) => void;

  private transform: TransformState = { x: 0, y: 0, scale: 1 };
  private pointers = new Map<number, PointerTracker>();

  // Panning state
  private isPanning = false;
  private panStartTransform: TransformState = { x: 0, y: 0, scale: 1 };
  private panStartMidpoint = { x: 0, y: 0 };

  // Pinch state
  private isPinching = false;
  private pinchStartDist = 0;
  private pinchStartScale = 1;
  private pinchFocalPoint = { x: 0, y: 0 };
  private pinchWorldPoint = { x: 0, y: 0 };

  // Telegram event unsubs
  private telegramCleanup: (() => void) | null = null;

  constructor(options?: TouchControllerOptions) {
    this.minScale = options?.minScale ?? 0.4;
    this.maxScale = options?.maxScale ?? 2.5;
    this.dragThreshold = options?.dragThreshold ?? 6;
    this.onTransform = options?.onTransform;
    this.onTap = options?.onTap;
  }

  public getTransform(): TransformState {
    return { ...this.transform };
  }

  public setTransform(transform: Partial<TransformState>): void {
    const scale = transform.scale !== undefined
      ? Math.max(this.minScale, Math.min(this.maxScale, transform.scale))
      : this.transform.scale;

    this.transform = {
      x: transform.x ?? this.transform.x,
      y: transform.y ?? this.transform.y,
      scale,
    };
    this.onTransform?.(this.getTransform());
  }

  public attach(element: HTMLElement): void {
    this.detach();
    this.element = element;
    element.style.touchAction = 'none';

    element.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('pointercancel', this.handlePointerUp);
    element.addEventListener('wheel', this.handleWheel, { passive: false });

    // Telegram WebApp viewport integration
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.onEvent) {
      const onViewport = () => {
        // Trigger transform notification to sync camera viewport size
        this.onTransform?.(this.getTransform());
      };
      tg.onEvent('viewportChanged', onViewport);
      this.telegramCleanup = () => {
        try {
          tg.offEvent?.('viewportChanged', onViewport);
        } catch {
          // Telegram SDK offEvent may throw if the WebApp context was already torn down
        }
      };
    }
  }

  public detach(): void {
    if (this.element) {
      this.element.removeEventListener('pointerdown', this.handlePointerDown);
      this.element.removeEventListener('wheel', this.handleWheel);
      this.element = null;
    }
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    window.removeEventListener('pointercancel', this.handlePointerUp);

    if (this.telegramCleanup) {
      this.telegramCleanup();
      this.telegramCleanup = null;
    }

    this.pointers.clear();
    this.isPanning = false;
    this.isPinching = false;
  }

  private handlePointerDown = (e: PointerEvent): void => {
    if (e.button !== undefined && e.button !== 0) return; // Left click / touch only

    this.pointers.set(e.pointerId, {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY,
      startTime: Date.now(),
    });

    if (this.pointers.size === 1) {
      this.isPanning = false;
      this.panStartTransform = { ...this.transform };
      this.panStartMidpoint = { x: e.clientX, y: e.clientY };
    } else if (this.pointers.size === 2) {
      this.startPinch();
    }
  };

  private handlePointerMove = (e: PointerEvent): void => {
    const ptr = this.pointers.get(e.pointerId);
    if (!ptr) return;

    ptr.currentX = e.clientX;
    ptr.currentY = e.clientY;

    if (this.pointers.size === 1 && !this.isPinching) {
      const dx = ptr.currentX - ptr.startX;
      const dy = ptr.currentY - ptr.startY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (!this.isPanning && dist > this.dragThreshold) {
        this.isPanning = true;
        this.panStartTransform = { ...this.transform };
        this.panStartMidpoint = { x: ptr.currentX, y: ptr.currentY };
      }

      if (this.isPanning) {
        const moveX = ptr.currentX - this.panStartMidpoint.x;
        const moveY = ptr.currentY - this.panStartMidpoint.y;
        this.setTransform({
          x: this.panStartTransform.x + moveX,
          y: this.panStartTransform.y + moveY,
        });
      }
    } else if (this.pointers.size >= 2) {
      this.updatePinch();
    }
  };

  private handlePointerUp = (e: PointerEvent): void => {
    const ptr = this.pointers.get(e.pointerId);
    if (ptr) {
      const dx = ptr.currentX - ptr.startX;
      const dy = ptr.currentY - ptr.startY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const elapsed = Date.now() - ptr.startTime;

      // Clean tap detection
      if (!this.isPanning && !this.isPinching && dist <= this.dragThreshold && elapsed < 300) {
        if (this.element) {
          const rect = this.element.getBoundingClientRect();
          this.onTap?.({
            screenX: ptr.currentX - rect.left,
            screenY: ptr.currentY - rect.top,
          });
        }
      }
    }

    this.pointers.delete(e.pointerId);

    if (this.pointers.size === 1) {
      this.isPinching = false;
      const remaining = Array.from(this.pointers.values())[0];
      this.isPanning = false;
      this.panStartTransform = { ...this.transform };
      this.panStartMidpoint = { x: remaining.currentX, y: remaining.currentY };
    } else if (this.pointers.size === 0) {
      this.isPanning = false;
      this.isPinching = false;
    }
  };

  private handleWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (!this.element) return;

    const rect = this.element.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.909;
    const nextScale = Math.max(this.minScale, Math.min(this.maxScale, this.transform.scale * zoomFactor));

    if (nextScale === this.transform.scale) return;

    // Zoom centered on cursor: world = (cursor - pos) / scale
    const worldX = (cursorX - this.transform.x) / this.transform.scale;
    const worldY = (cursorY - this.transform.y) / this.transform.scale;

    this.setTransform({
      scale: nextScale,
      x: cursorX - worldX * nextScale,
      y: cursorY - worldY * nextScale,
    });
  };

  private startPinch(): void {
    const ptrs = Array.from(this.pointers.values());
    if (ptrs.length < 2 || !this.element) return;

    this.isPanning = false;
    this.isPinching = true;

    const dx = ptrs[1].currentX - ptrs[0].currentX;
    const dy = ptrs[1].currentY - ptrs[0].currentY;
    this.pinchStartDist = Math.max(10, Math.sqrt(dx * dx + dy * dy));
    this.pinchStartScale = this.transform.scale;

    const rect = this.element.getBoundingClientRect();
    this.pinchFocalPoint = {
      x: (ptrs[0].currentX + ptrs[1].currentX) / 2 - rect.left,
      y: (ptrs[0].currentY + ptrs[1].currentY) / 2 - rect.top,
    };

    this.pinchWorldPoint = {
      x: (this.pinchFocalPoint.x - this.transform.x) / this.transform.scale,
      y: (this.pinchFocalPoint.y - this.transform.y) / this.transform.scale,
    };
  }

  private updatePinch(): void {
    const ptrs = Array.from(this.pointers.values());
    if (ptrs.length < 2 || !this.element) return;

    const dx = ptrs[1].currentX - ptrs[0].currentX;
    const dy = ptrs[1].currentY - ptrs[0].currentY;
    const dist = Math.max(10, Math.sqrt(dx * dx + dy * dy));

    const ratio = dist / this.pinchStartDist;
    const nextScale = Math.max(this.minScale, Math.min(this.maxScale, this.pinchStartScale * ratio));

    const rect = this.element.getBoundingClientRect();
    const currentFocal = {
      x: (ptrs[0].currentX + ptrs[1].currentX) / 2 - rect.left,
      y: (ptrs[0].currentY + ptrs[1].currentY) / 2 - rect.top,
    };

    this.setTransform({
      scale: nextScale,
      x: currentFocal.x - this.pinchWorldPoint.x * nextScale,
      y: currentFocal.y - this.pinchWorldPoint.y * nextScale,
    });
  }
}
