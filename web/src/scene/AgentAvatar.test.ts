import { describe, it, expect, mock } from 'bun:test';
import { AgentAvatar } from './AgentAvatar';
import type { Agent } from '../types';

if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
    return setTimeout(() => cb(Date.now()), 16) as any;
  };
  globalThis.cancelAnimationFrame = (id: number) => {
    clearTimeout(id);
  };
}

if (typeof (globalThis as any).CanvasRenderingContext2D === 'undefined') {
  (globalThis as any).CanvasRenderingContext2D = class CanvasRenderingContext2D {};
}

if (typeof globalThis.document === 'undefined') {
  (globalThis as any).document = {
    createElement: (tag: string) => {
      if (tag === 'canvas') {
        return {
          getContext: () => ({
            measureText: (text: string) => ({
              width: (text || '').length * 7,
              actualBoundingBoxAscent: 8,
              actualBoundingBoxDescent: 2,
            }),
            font: '',
            fillRect: () => {},
            clearRect: () => {},
            getImageData: () => ({ data: [] }),
            putImageData: () => {},
          }),
          width: 0,
          height: 0,
        };
      }
      return {};
    },
  };
}

describe('AO-TYCOON-07: AgentAvatar', () => {
  const mockAgent: Agent = {
    id: 'coder',
    profile_name: 'Coder',
    role: 'Game Developer',
    status: 'idle',
    current_model: 'anthropic/claude-3-5-sonnet',
  };

  const mockTextures: Record<string, any> = {
    miro_idle: { width: 80, height: 112 },
    miro_typing_01: { width: 80, height: 112 },
    miro_typing_02: { width: 80, height: 112 },
  };

  const mockSpritesheet: any = {
    textures: mockTextures,
  };

  it('initializes in idle mode with idle sprite visible and typing invisible', () => {
    const avatar = new AgentAvatar({
      agent: mockAgent,
      spritesheet: mockSpritesheet,
    });

    expect(avatar.agentId).toBe('coder');
    expect(avatar.container).toBeDefined();

    const idle = (avatar as any).idleSprite;
    const typing = (avatar as any).typingSprite;
    expect(idle.visible).toBe(true);
    expect(typing.visible).toBe(false);

    avatar.destroy();
  });

  it('switches to working mode: typing visible and idle invisible', () => {
    const avatar = new AgentAvatar({
      agent: mockAgent,
      spritesheet: mockSpritesheet,
    });

    avatar.setStatus('working');
    const idle = (avatar as any).idleSprite;
    const typing = (avatar as any).typingSprite;
    expect(idle.visible).toBe(false);
    expect(typing.visible).toBe(true);

    avatar.setStatus('idle');
    expect(idle.visible).toBe(true);
    expect(typing.visible).toBe(false);

    avatar.destroy();
  });

  it('updates bubble content cleanly', () => {
    const avatar = new AgentAvatar({
      agent: mockAgent,
      spritesheet: mockSpritesheet,
    });

    avatar.setBubbleContent('Coder', 'Coding task #42');
    expect((avatar as any).bubbleText.text).toBe('Coder');
    expect((avatar as any).bubbleSubtext.text).toBe('Coding task #42');

    avatar.destroy();
  });

  it('counter-scales bubble based on camera zoom level', () => {
    const avatar = new AgentAvatar({
      agent: mockAgent,
      spritesheet: mockSpritesheet,
    });

    const bubble = (avatar as any).bubbleContainer;
    avatar.setZoomScale(2.0); // zoomed in
    expect(bubble.scale.x).toBeLessThan(1.0);

    avatar.setZoomScale(0.5); // zoomed out
    expect(bubble.scale.x).toBeGreaterThan(1.0);

    avatar.destroy();
  });

  it('calls onSelect when pointerdown is triggered on container', () => {
    const onSelect = mock();
    const avatar = new AgentAvatar({
      agent: mockAgent,
      spritesheet: mockSpritesheet,
      onSelect,
    });

    avatar.container.emit('pointerdown', { stopPropagation: () => {} } as any);
    expect(onSelect).toHaveBeenCalledWith('coder');

    avatar.destroy();
  });
});
