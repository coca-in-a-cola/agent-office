import { describe, it, expect } from 'bun:test';
import {
  PixiContextLifecycleController,
  type ContextEventTarget,
  type ContextTickerTarget,
  type ContextRecoveryState,
} from './pixiContextLifecycle';

class MockCanvasTarget implements ContextEventTarget {
  public listeners: Record<string, Set<(e: any) => void>> = {};

  addEventListener(type: string, listener: (e: any) => void): void {
    if (!this.listeners[type]) {
      this.listeners[type] = new Set();
    }
    this.listeners[type].add(listener);
  }

  removeEventListener(type: string, listener: (e: any) => void): void {
    if (this.listeners[type]) {
      this.listeners[type].delete(listener);
    }
  }

  dispatchEvent(type: string, event: any): void {
    const list = this.listeners[type];
    if (list) {
      for (const listener of Array.from(list)) {
        listener(event);
      }
    }
  }

  getListenerCount(type: string): number {
    return this.listeners[type]?.size ?? 0;
  }
}

class MockTickerTarget implements ContextTickerTarget {
  public startCalls = 0;
  public stopCalls = 0;
  public started = true;

  start(): void {
    this.startCalls++;
    this.started = true;
  }

  stop(): void {
    this.stopCalls++;
    this.started = false;
  }
}

describe('AO-TYCOON-01: PixiContextLifecycleController', () => {
  it('attaches listeners to canvas target without duplicates', () => {
    const controller = new PixiContextLifecycleController();
    const canvas = new MockCanvasTarget();
    const ticker = new MockTickerTarget();

    controller.attach({
      canvas,
      ticker,
      onRestore: () => {},
    });

    expect(canvas.getListenerCount('webglcontextlost')).toBe(1);
    expect(canvas.getListenerCount('webglcontextrestored')).toBe(1);
    expect(controller.getState()).toBe('ready');
    expect(controller.isAttached()).toBe(true);

    // Re-attach must clean up previous listeners and not duplicate
    controller.attach({
      canvas,
      ticker,
      onRestore: () => {},
    });

    expect(canvas.getListenerCount('webglcontextlost')).toBe(1);
    expect(canvas.getListenerCount('webglcontextrestored')).toBe(1);
  });

  it('handles webglcontextlost: prevents default, stops ticker, and updates state', () => {
    const controller = new PixiContextLifecycleController();
    const canvas = new MockCanvasTarget();
    const ticker = new MockTickerTarget();
    const stateTransitions: ContextRecoveryState[] = [];

    controller.attach({
      canvas,
      ticker,
      onRestore: () => {},
      onStateChange: (state) => stateTransitions.push(state),
    });

    let preventDefaultCalled = false;
    const fakeLostEvent = {
      preventDefault: () => {
        preventDefaultCalled = true;
      },
    };

    canvas.dispatchEvent('webglcontextlost', fakeLostEvent);

    expect(preventDefaultCalled).toBe(true);
    expect(ticker.stopCalls).toBe(1);
    expect(ticker.started).toBe(false);
    expect(controller.getState()).toBe('lost');
    expect(stateTransitions).toEqual(['lost']);
  });

  it('handles webglcontextrestored: restores scene, restarts ticker, and returns to ready state', async () => {
    const controller = new PixiContextLifecycleController();
    const canvas = new MockCanvasTarget();
    const ticker = new MockTickerTarget();
    const stateTransitions: ContextRecoveryState[] = [];
    let restoreCalled = false;

    controller.attach({
      canvas,
      ticker,
      onRestore: async () => {
        restoreCalled = true;
      },
      onStateChange: (state) => stateTransitions.push(state),
    });

    canvas.dispatchEvent('webglcontextlost', { preventDefault: () => {} });
    expect(controller.getState()).toBe('lost');

    await canvas.listeners['webglcontextrestored']?.values().next().value?.({});

    expect(restoreCalled).toBe(true);
    expect(ticker.startCalls).toBe(1);
    expect(ticker.started).toBe(true);
    expect(controller.getState()).toBe('ready');
    expect(stateTransitions).toEqual(['lost', 'recovering', 'ready']);
  });

  it('transitions to error state and skips ticker start if scene restoration fails', async () => {
    const controller = new PixiContextLifecycleController();
    const canvas = new MockCanvasTarget();
    const ticker = new MockTickerTarget();
    const stateTransitions: ContextRecoveryState[] = [];
    let capturedError: Error | null = null;

    controller.attach({
      canvas,
      ticker,
      onRestore: async () => {
        throw new Error('GL shader compile error after restore');
      },
      onStateChange: (state) => stateTransitions.push(state),
      onError: (err) => {
        capturedError = err;
      },
    });

    canvas.dispatchEvent('webglcontextlost', { preventDefault: () => {} });
    await canvas.listeners['webglcontextrestored']?.values().next().value?.({});

    const err = capturedError as Error | null;
    expect(ticker.startCalls).toBe(0);
    expect(controller.getState()).toBe('error');
    expect(err?.message).toBe('GL shader compile error after restore');
    expect(stateTransitions).toEqual(['lost', 'recovering', 'error']);
  });

  it('cleans up completely on detach() and prevents leaks', () => {
    const controller = new PixiContextLifecycleController();
    const canvas = new MockCanvasTarget();
    const ticker = new MockTickerTarget();

    controller.attach({
      canvas,
      ticker,
      onRestore: () => {},
    });

    expect(canvas.getListenerCount('webglcontextlost')).toBe(1);
    expect(canvas.getListenerCount('webglcontextrestored')).toBe(1);

    controller.detach();

    expect(canvas.getListenerCount('webglcontextlost')).toBe(0);
    expect(canvas.getListenerCount('webglcontextrestored')).toBe(0);
    expect(controller.isAttached()).toBe(false);

    // Further dispatched events should do nothing
    canvas.dispatchEvent('webglcontextlost', { preventDefault: () => {} });
    expect(ticker.stopCalls).toBe(0);
  });

  it('aborts post-restore ticker restart if detached while async restore is in flight', async () => {
    const controller = new PixiContextLifecycleController();
    const canvas = new MockCanvasTarget();
    const ticker = new MockTickerTarget();
    let resolveRestore: () => void = () => {};

    controller.attach({
      canvas,
      ticker,
      onRestore: () => new Promise<void>((resolve) => {
        resolveRestore = resolve;
      }),
    });

    canvas.dispatchEvent('webglcontextlost', { preventDefault: () => {} });

    // Trigger restore (starts promise)
    const restorePromise = controller.handleContextRestored();
    expect(controller.getState()).toBe('recovering');

    // Unmount / detach happens while restore is pending
    controller.detach();

    // Now resolve the restore promise
    resolveRestore();
    await restorePromise;

    // Ticker should NOT have been started because controller was detached
    expect(ticker.startCalls).toBe(0);
  });

  it('supports multiple sequential recovery cycles cleanly', async () => {
    const controller = new PixiContextLifecycleController();
    const canvas = new MockCanvasTarget();
    const ticker = new MockTickerTarget();
    let restoreCount = 0;

    controller.attach({
      canvas,
      ticker,
      onRestore: () => {
        restoreCount++;
      },
    });

    // Cycle 1
    canvas.dispatchEvent('webglcontextlost', { preventDefault: () => {} });
    expect(controller.getState()).toBe('lost');
    await controller.handleContextRestored();
    expect(controller.getState()).toBe('ready');

    // Cycle 2
    canvas.dispatchEvent('webglcontextlost', { preventDefault: () => {} });
    expect(controller.getState()).toBe('lost');
    await controller.handleContextRestored();
    expect(controller.getState()).toBe('ready');

    expect(restoreCount).toBe(2);
    expect(ticker.stopCalls).toBe(2);
    expect(ticker.startCalls).toBe(2);
    expect(canvas.getListenerCount('webglcontextlost')).toBe(1);
    expect(canvas.getListenerCount('webglcontextrestored')).toBe(1);
  });
});
