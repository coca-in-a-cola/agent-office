import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { TouchController, type TapEvent, type TransformState } from './TouchController';

class MockEventTarget {
  public listeners: Record<string, Function[]> = {};

  addEventListener(type: string, listener: any, _options?: any): void {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: any): void {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
  }

  dispatchEvent(event: any): boolean {
    const list = this.listeners[event.type] || [];
    for (const l of [...list]) {
      l(event);
    }
    return true;
  }

  listenerCount(type: string): number {
    return this.listeners[type]?.length ?? 0;
  }
}

class MockElement extends MockEventTarget {
  public style: Record<string, string> = {};
  public rect: DOMRect = {
    left: 100,
    top: 50,
    width: 800,
    height: 600,
    right: 900,
    bottom: 650,
    x: 100,
    y: 50,
    toJSON: () => ({}),
  };

  getBoundingClientRect(): DOMRect {
    return this.rect;
  }
}

class MockWindow extends MockEventTarget {
  public Telegram?: any;
}

describe('TouchController', () => {
  let mockWindow: MockWindow;
  let mockElement: MockElement;
  let originalWindow: any;

  beforeEach(() => {
    originalWindow = (globalThis as any).window;
    mockWindow = new MockWindow();
    (globalThis as any).window = mockWindow;
    mockElement = new MockElement();
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
  });

  it('pointer down and movement <= 6px fires onTap on pointerup and does NOT trigger transform pan', () => {
    let tapResult: TapEvent | null = null;
    let transformResult: TransformState | null = null;

    const controller = new TouchController({
      dragThreshold: 6,
      onTap: (tap) => {
        tapResult = tap;
      },
      onTransform: (t) => {
        transformResult = t;
      },
    });

    controller.attach(mockElement as unknown as HTMLElement);

    // Initial pointerdown at (150, 100) (element rect is left: 100, top: 50)
    mockElement.dispatchEvent({
      type: 'pointerdown',
      pointerId: 1,
      clientX: 150,
      clientY: 100,
      button: 0,
    });

    // Small movement: 3px X, 2px Y (dist = sqrt(9 + 4) = 3.6px <= 6px)
    mockWindow.dispatchEvent({
      type: 'pointermove',
      pointerId: 1,
      clientX: 153,
      clientY: 102,
    });

    // Transform pan should NOT have been triggered
    expect(transformResult).toBeNull();

    // Pointer up
    mockWindow.dispatchEvent({
      type: 'pointerup',
      pointerId: 1,
      clientX: 153,
      clientY: 102,
    });

    // Tap should be detected with coordinates relative to element
    expect(tapResult).not.toBeNull();
    expect(tapResult!.screenX).toBe(53); // 153 - 100
    expect(tapResult!.screenY).toBe(52); // 102 - 50
    expect(transformResult).toBeNull();

    controller.detach();
  });

  it('pointer down and movement > 6px triggers transform pan and does NOT fire onTap', () => {
    let tapResult: TapEvent | null = null;
    const transforms: TransformState[] = [];

    const controller = new TouchController({
      dragThreshold: 6,
      onTap: (tap) => {
        tapResult = tap;
      },
      onTransform: (t) => {
        transforms.push({ ...t });
      },
    });

    controller.attach(mockElement as unknown as HTMLElement);

    mockElement.dispatchEvent({
      type: 'pointerdown',
      pointerId: 1,
      clientX: 150,
      clientY: 100,
      button: 0,
    });

    // Movement of 10px X > threshold of 6px: crosses deadzone and engages pan
    mockWindow.dispatchEvent({
      type: 'pointermove',
      pointerId: 1,
      clientX: 160,
      clientY: 100,
    });

    // Move further while panning
    mockWindow.dispatchEvent({
      type: 'pointermove',
      pointerId: 1,
      clientX: 175,
      clientY: 120,
    });

    expect(transforms.length).toBeGreaterThan(0);
    const lastTransform = transforms[transforms.length - 1];
    expect(lastTransform.x).toBe(15);
    expect(lastTransform.y).toBe(20);

    // Pointer up after drag
    mockWindow.dispatchEvent({
      type: 'pointerup',
      pointerId: 1,
      clientX: 175,
      clientY: 120,
    });

    // Tap must NOT fire when dragging occurs
    expect(tapResult).toBeNull();

    controller.detach();
  });

  it('2-pointer pinch scales up/down and respects minScale (0.4) and maxScale (2.5)', () => {
    const transforms: TransformState[] = [];

    const controller = new TouchController({
      minScale: 0.4,
      maxScale: 2.5,
      onTransform: (t) => {
        transforms.push({ ...t });
      },
    });

    controller.attach(mockElement as unknown as HTMLElement);

    // Pointer 1 down at (200, 200)
    mockElement.dispatchEvent({
      type: 'pointerdown',
      pointerId: 1,
      clientX: 200,
      clientY: 200,
      button: 0,
    });

    // Pointer 2 down at (300, 200) -> initial distance is 100px
    mockElement.dispatchEvent({
      type: 'pointerdown',
      pointerId: 2,
      clientX: 300,
      clientY: 200,
      button: 0,
    });

    // Spread pointers to distance 200px (2x scale)
    mockWindow.dispatchEvent({
      type: 'pointermove',
      pointerId: 2,
      clientX: 400,
      clientY: 200,
    });

    const pinchScale = controller.getTransform().scale;
    expect(pinchScale).toBeCloseTo(2.0, 2);

    // Spread pointers very wide to exceed maxScale 2.5 (e.g. distance 400px -> 4x)
    mockWindow.dispatchEvent({
      type: 'pointermove',
      pointerId: 2,
      clientX: 600,
      clientY: 200,
    });

    expect(controller.getTransform().scale).toBe(2.5);

    // Pinch in very tight (distance 20px -> 0.2x) -> clamped to minScale 0.4
    mockWindow.dispatchEvent({
      type: 'pointermove',
      pointerId: 2,
      clientX: 220,
      clientY: 200,
    });

    expect(controller.getTransform().scale).toBe(0.4);

    controller.detach();
  });

  it('mouse wheel zooms centered on cursor and clamps', () => {
    const controller = new TouchController({
      minScale: 0.4,
      maxScale: 2.5,
    });

    controller.attach(mockElement as unknown as HTMLElement);

    let prevented = false;
    // Zoom in: deltaY < 0. Element left=100, top=50. ClientX=300, clientY=250 => cursorX=200, cursorY=200
    mockElement.dispatchEvent({
      type: 'wheel',
      clientX: 300,
      clientY: 250,
      deltaY: -100,
      preventDefault: () => {
        prevented = true;
      },
    });

    expect(prevented).toBe(true);
    expect(controller.getTransform().scale).toBeCloseTo(1.1, 3);

    // Repeated zoom in hits maxScale 2.5
    for (let i = 0; i < 20; i++) {
      mockElement.dispatchEvent({
        type: 'wheel',
        clientX: 300,
        clientY: 250,
        deltaY: -100,
        preventDefault: () => {},
      });
    }
    expect(controller.getTransform().scale).toBe(2.5);

    // Repeated zoom out hits minScale 0.4
    for (let i = 0; i < 30; i++) {
      mockElement.dispatchEvent({
        type: 'wheel',
        clientX: 300,
        clientY: 250,
        deltaY: 100,
        preventDefault: () => {},
      });
    }
    expect(controller.getTransform().scale).toBe(0.4);

    controller.detach();
  });

  it('detach() cleanly deregisters listeners', () => {
    let viewportCallback: (() => void) | null = null;
    let unsubscribed = false;

    mockWindow.Telegram = {
      WebApp: {
        onEvent: (name: string, cb: () => void) => {
          if (name === 'viewportChanged') viewportCallback = cb;
        },
        offEvent: (name: string, _cb: () => void) => {
          if (name === 'viewportChanged') unsubscribed = true;
        },
      },
    };

    const controller = new TouchController();
    controller.attach(mockElement as unknown as HTMLElement);

    expect(mockElement.style.touchAction).toBe('none');
    expect(mockElement.listenerCount('pointerdown')).toBe(1);
    expect(mockElement.listenerCount('wheel')).toBe(1);
    expect(mockWindow.listenerCount('pointermove')).toBe(1);
    expect(mockWindow.listenerCount('pointerup')).toBe(1);
    expect(mockWindow.listenerCount('pointercancel')).toBe(1);
    expect(viewportCallback).not.toBeNull();

    controller.detach();

    expect(mockElement.listenerCount('pointerdown')).toBe(0);
    expect(mockElement.listenerCount('wheel')).toBe(0);
    expect(mockWindow.listenerCount('pointermove')).toBe(0);
    expect(mockWindow.listenerCount('pointerup')).toBe(0);
    expect(mockWindow.listenerCount('pointercancel')).toBe(0);
    expect(unsubscribed).toBe(true);
  });
});
