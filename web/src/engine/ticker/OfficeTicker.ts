/**
 * OfficeTicker: Decoupled animation and simulation loop for Agent Office Tycoon.
 * 
 * Provides:
 * - requestAnimationFrame with fallback / node-safe timer loop when requestAnimationFrame is missing.
 * - Methods: add(fn), remove(fn), start(), stop(), destroy().
 * - Provides deltaMS, elapsedMS, FPS tracking.
 * - Prevents React component re-renders from driving the animation loop.
 */

export interface TickerPayload {
  deltaMS: number;
  elapsedMS: number;
  fps: number;
}

export type TickerListener = (payload: TickerPayload) => void;

export class OfficeTicker {
  private listeners: Set<TickerListener> = new Set();
  private isRunning: boolean = false;
  private isDestroyed: boolean = false;
  private rafId: number | null = null;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private lastTime: number = 0;
  private elapsedMS: number = 0;
  private fps: number = 60;
  private frameCount: number = 0;
  private fpsSampleWindowStart: number = 0;
  private readonly boundTick: (now: number) => void;

  constructor() {
    this.boundTick = this.tick.bind(this);
    const now = this.now();
    this.lastTime = now;
    this.fpsSampleWindowStart = now;
  }

  public get running(): boolean {
    return this.isRunning;
  }

  public get currentFps(): number {
    return this.fps;
  }

  public get totalElapsedMS(): number {
    return this.elapsedMS;
  }

  public get destroyed(): boolean {
    return this.isDestroyed;
  }

  public add(fn: TickerListener): () => void {
    if (this.isDestroyed) {
      return () => {};
    }
    this.listeners.add(fn);
    return () => this.remove(fn);
  }

  public remove(fn: TickerListener): void {
    this.listeners.delete(fn);
  }

  public start(): void {
    if (this.isRunning || this.isDestroyed) return;
    this.isRunning = true;
    const now = this.now();
    this.lastTime = now;
    this.fpsSampleWindowStart = now;
    this.frameCount = 0;
    this.scheduleNextFrame();
  }

  public stop(): void {
    this.isRunning = false;
    this.cancelScheduledFrame();
  }

  public destroy(): void {
    this.stop();
    this.isDestroyed = true;
    this.listeners.clear();
  }

  /**
   * For testing or manual advancement without waiting on timers/frames.
   */
  public step(customDeltaMS?: number): void {
    if (this.isDestroyed) return;
    if (customDeltaMS !== undefined) {
      const targetTime = this.lastTime + customDeltaMS;
      this.tick(targetTime);
    } else {
      this.tick(this.now());
    }
  }

  private now(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }

  private scheduleNextFrame(): void {
    if (!this.isRunning || this.isDestroyed) return;

    if (typeof requestAnimationFrame === 'function') {
      this.rafId = requestAnimationFrame(this.boundTick);
    } else {
      this.timerId = setTimeout(() => {
        this.boundTick(this.now());
      }, 16);
    }
  }

  private cancelScheduledFrame(): void {
    if (this.rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  private tick(now: number): void {
    const deltaMS = Math.max(0, now - this.lastTime);
    this.lastTime = now;
    this.elapsedMS += deltaMS;

    this.frameCount++;
    const windowElapsed = now - this.fpsSampleWindowStart;
    if (windowElapsed >= 500) {
      this.fps = Math.round((this.frameCount * 1000) / windowElapsed);
      this.frameCount = 0;
      this.fpsSampleWindowStart = now;
    }

    const payload: TickerPayload = {
      deltaMS,
      elapsedMS: this.elapsedMS,
      fps: this.fps,
    };

    const listenersSnapshot = Array.from(this.listeners);
    for (const listener of listenersSnapshot) {
      try {
        listener(payload);
      } catch (err) {
        console.error('OfficeTicker listener error:', err);
      }
    }

    if (this.isRunning && !this.isDestroyed) {
      this.scheduleNextFrame();
    }
  }
}
