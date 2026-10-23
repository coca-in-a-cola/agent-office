export type ContextRecoveryState = 'ready' | 'lost' | 'recovering' | 'error';

export interface ContextEventTarget {
  addEventListener(type: string, listener: (event: any) => void, options?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, listener: (event: any) => void, options?: boolean | EventListenerOptions): void;
}

export interface ContextTickerTarget {
  start(): void;
  stop(): void;
  started?: boolean;
}

export interface ContextLifecycleOptions {
  canvas: ContextEventTarget;
  ticker?: ContextTickerTarget;
  onRestore: () => Promise<void> | void;
  onStateChange?: (state: ContextRecoveryState) => void;
  onError?: (error: Error) => void;
}

export class PixiContextLifecycleController {
  private attached = false;
  private canvas: ContextEventTarget | null = null;
  private ticker: ContextTickerTarget | null = null;
  private onRestore: (() => Promise<void> | void) | null = null;
  private onStateChange: ((state: ContextRecoveryState) => void) | null = null;
  private onError: ((error: Error) => void) | null = null;
  private state: ContextRecoveryState = 'ready';
  private restoreCount = 0;

  private readonly boundLost = (e: any) => this.handleContextLost(e);
  private readonly boundRestored = (e: any) => this.handleContextRestored(e);

  public attach(options: ContextLifecycleOptions): void {
    if (this.attached) {
      this.detach();
    }

    this.canvas = options.canvas;
    this.ticker = options.ticker ?? null;
    this.onRestore = options.onRestore;
    this.onStateChange = options.onStateChange ?? null;
    this.onError = options.onError ?? null;
    this.attached = true;
    this.state = 'ready';

    this.canvas.addEventListener('webglcontextlost', this.boundLost, false);
    this.canvas.addEventListener('webglcontextrestored', this.boundRestored, false);
  }

  public handleContextLost(event: { preventDefault?: () => void }): void {
    if (!this.attached) return;

    if (typeof event?.preventDefault === 'function') {
      event.preventDefault();
    }

    if (this.ticker) {
      this.ticker.stop();
    }

    this.state = 'lost';
    this.onStateChange?.('lost');
  }

  public async handleContextRestored(_event?: any): Promise<void> {
    if (!this.attached) return;

    const currentCycle = ++this.restoreCount;
    this.state = 'recovering';
    this.onStateChange?.('recovering');

    try {
      if (this.onRestore) {
        await this.onRestore();
      }

      // Check if detached or superseded by another event during async restore
      if (!this.attached || currentCycle !== this.restoreCount) {
        return;
      }

      if (this.ticker) {
        this.ticker.start();
      }

      this.state = 'ready';
      this.onStateChange?.('ready');
    } catch (err: any) {
      if (!this.attached || currentCycle !== this.restoreCount) {
        return;
      }

      const error = err instanceof Error ? err : new Error(String(err));
      this.state = 'error';
      this.onStateChange?.('error');
      this.onError?.(error);
    }
  }

  public detach(): void {
    if (this.canvas) {
      this.canvas.removeEventListener('webglcontextlost', this.boundLost, false);
      this.canvas.removeEventListener('webglcontextrestored', this.boundRestored, false);
    }

    this.attached = false;
    this.canvas = null;
    this.ticker = null;
    this.onRestore = null;
    this.onStateChange = null;
    this.onError = null;
  }

  public getState(): ContextRecoveryState {
    return this.state;
  }

  public isAttached(): boolean {
    return this.attached;
  }
}
