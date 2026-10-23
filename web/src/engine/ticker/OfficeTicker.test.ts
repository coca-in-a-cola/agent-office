import { describe, expect, it } from 'bun:test';
import { OfficeTicker, type TickerPayload } from './OfficeTicker';

describe('OfficeTicker', () => {
  it('initializes in stopped state with 0 elapsed time', () => {
    const ticker = new OfficeTicker();
    expect(ticker.running).toBe(false);
    expect(ticker.totalElapsedMS).toBe(0);
    expect(ticker.destroyed).toBe(false);
    ticker.destroy();
  });

  it('starts and stops cleanly', () => {
    const ticker = new OfficeTicker();
    ticker.start();
    expect(ticker.running).toBe(true);

    ticker.stop();
    expect(ticker.running).toBe(false);
    ticker.destroy();
  });

  it('notifies registered listeners during step/tick with deltaMS and elapsedMS', () => {
    const ticker = new OfficeTicker();
    const payloads: TickerPayload[] = [];

    const unsubscribe = ticker.add((payload) => {
      payloads.push(payload);
    });

    ticker.step(16.6);
    ticker.step(16.6);

    expect(payloads.length).toBe(2);
    expect(payloads[0].deltaMS).toBeCloseTo(16.6, 1);
    expect(payloads[1].deltaMS).toBeCloseTo(16.6, 1);
    expect(payloads[1].elapsedMS).toBeCloseTo(33.2, 1);
    expect(ticker.totalElapsedMS).toBeCloseTo(33.2, 1);

    unsubscribe();
    ticker.step(16.6);
    expect(payloads.length).toBe(2); // no new payloads after unsubscribe
    ticker.destroy();
  });

  it('supports explicit remove() method', () => {
    const ticker = new OfficeTicker();
    let callCount = 0;
    const listener = () => {
      callCount++;
    };

    ticker.add(listener);
    ticker.step(16);
    expect(callCount).toBe(1);

    ticker.remove(listener);
    ticker.step(16);
    expect(callCount).toBe(1);
    ticker.destroy();
  });

  it('tracks FPS calculation accurately over sample window', () => {
    const ticker = new OfficeTicker();
    // Simulate 30 frames of 16.66ms (~500ms total)
    for (let i = 0; i < 30; i++) {
      ticker.step(16.666);
    }
    // 30 frames / 0.5s = 60 FPS
    expect(ticker.currentFps).toBeGreaterThanOrEqual(58);
    expect(ticker.currentFps).toBeLessThanOrEqual(62);
    ticker.destroy();
  });

  it('cleans up all listeners and stops on destroy()', () => {
    const ticker = new OfficeTicker();
    let callCount = 0;
    ticker.add(() => {
      callCount++;
    });

    ticker.start();
    expect(ticker.running).toBe(true);

    ticker.destroy();
    expect(ticker.running).toBe(false);
    expect(ticker.destroyed).toBe(true);

    ticker.step(16);
    expect(callCount).toBe(0);

    // Starting or adding after destroy should be a no-op
    ticker.start();
    expect(ticker.running).toBe(false);
  });

  it('safely handles errors thrown inside a listener without breaking other listeners', () => {
    const ticker = new OfficeTicker();
    let secondListenerCalled = false;

    ticker.add(() => {
      throw new Error('Listener failed intentional test');
    });

    ticker.add(() => {
      secondListenerCalled = true;
    });

    ticker.step(16);
    expect(secondListenerCalled).toBe(true);
    ticker.destroy();
  });

  it('runs automatically when started with node timer fallback', async () => {
    const ticker = new OfficeTicker();
    let ticks = 0;

    ticker.add(() => {
      ticks++;
    });

    ticker.start();
    await new Promise((resolve) => setTimeout(resolve, 80));
    ticker.stop();

    expect(ticks).toBeGreaterThanOrEqual(2);
    ticker.destroy();
  });
});
