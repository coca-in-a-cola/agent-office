/**
 * AgentAvatar component for PixiJS canvas.
 * Manages individual agent sprite hierarchy, animation states (idle vs typing/working),
 * zoom-independent status bubbles, and tap/click interaction.
 */

import { Container, Sprite, AnimatedSprite, Graphics, Text, type Spritesheet } from 'pixi.js';
import type { Agent, AgentStatus } from '../types';

export interface AgentAvatarOptions {
  agent: Agent;
  spritesheet: Spritesheet;
  onSelect?: (agentId: string) => void;
}

export class AgentAvatar {
  public readonly agentId: string;
  public readonly container: Container;

  private idleSprite: Sprite;
  private typingSprite: AnimatedSprite;
  private bubbleContainer: Container;
  private bubbleBg: Graphics;
  private bubbleText: Text;
  private bubbleSubtext: Text;

  private currentStatus: AgentStatus;
  private onSelect?: (agentId: string) => void;

  constructor(options: AgentAvatarOptions) {
    this.agentId = options.agent.id;
    this.currentStatus = options.agent.status || 'idle';
    this.onSelect = options.onSelect;

    this.container = new Container();
    this.container.eventMode = 'static';
    this.container.cursor = 'pointer';
    this.container.on('pointerdown', (e) => {
      e.stopPropagation();
      this.onSelect?.(this.agentId);
    });

    const { spritesheet } = options;

    // 1. Idle Sprite
    const idleTexture = spritesheet.textures['miro_idle'];
    this.idleSprite = new Sprite(idleTexture);
    this.idleSprite.anchor.set(40 / 80, 103 / 112);
    this.idleSprite.visible = this.currentStatus !== 'working';
    this.container.addChild(this.idleSprite);

    // 2. Typing / Working Animated Sprite (6 FPS)
    const typingTextures = [
      spritesheet.textures['miro_typing_01'],
      spritesheet.textures['miro_typing_02'],
    ];
    this.typingSprite = new AnimatedSprite(typingTextures);
    this.typingSprite.anchor.set(40 / 80, 103 / 112);
    this.typingSprite.animationSpeed = 6 / 60;
    this.typingSprite.play();
    this.typingSprite.visible = this.currentStatus === 'working';
    this.container.addChild(this.typingSprite);

    // 3. Status Bubble Container (anchored above head at y = -65)
    this.bubbleContainer = new Container();
    this.bubbleContainer.position.set(0, -68);
    this.bubbleContainer.eventMode = 'none';

    this.bubbleBg = new Graphics();
    this.bubbleContainer.addChild(this.bubbleBg);

    this.bubbleText = new Text({
      text: options.agent.profile_name || options.agent.id,
      style: {
        fontFamily: 'Inter, sans-serif',
        fontSize: 10,
        fontWeight: 'bold',
        fill: 0xffffff,
        align: 'center',
      },
    });
    this.bubbleText.anchor.set(0.5, 0.5);
    this.bubbleText.position.set(0, -7);
    this.bubbleContainer.addChild(this.bubbleText);

    this.bubbleSubtext = new Text({
      text: options.agent.current_model?.split('/').pop() || options.agent.status,
      style: {
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 8,
        fill: 0x94a3b8,
        align: 'center',
      },
    });
    this.bubbleSubtext.anchor.set(0.5, 0.5);
    this.bubbleSubtext.position.set(0, 4);
    this.bubbleContainer.addChild(this.bubbleSubtext);

    this.drawBubbleBackground();
    this.container.addChild(this.bubbleContainer);
  }

  private drawBubbleBackground(): void {
    this.bubbleBg.clear();
    const width = Math.max(70, Math.max(this.bubbleText.width, this.bubbleSubtext.width) + 16);
    const height = 26;

    // Glassmorphic rounded bubble with pointer tail
    this.bubbleBg.roundRect(-width / 2, -height / 2, width, height, 6);
    this.bubbleBg.fill({ color: 0x0f172a, alpha: 0.88 });
    this.bubbleBg.stroke({ width: 1, color: this.currentStatus === 'working' ? 0x38bdf8 : 0x334155 });

    // Pointer notch triangle at bottom
    this.bubbleBg.poly([
      { x: -4, y: height / 2 },
      { x: 4, y: height / 2 },
      { x: 0, y: height / 2 + 5 },
    ]);
    this.bubbleBg.fill({ color: 0x0f172a, alpha: 0.88 });
  }

  public setStatus(status: AgentStatus): void {
    this.currentStatus = status;
    const isWorking = status === 'working';

    this.idleSprite.visible = !isWorking;
    this.typingSprite.visible = isWorking;

    if (isWorking) {
      this.typingSprite.play();
    } else {
      this.typingSprite.stop();
    }

    this.bubbleSubtext.text = status.toUpperCase();
    this.drawBubbleBackground();
  }

  public setBubbleContent(title: string, subtext?: string): void {
    this.bubbleText.text = title;
    if (subtext !== undefined) {
      this.bubbleSubtext.text = subtext;
    }
    this.drawBubbleBackground();
  }

  public setZoomScale(cameraScale: number): void {
    if (cameraScale <= 0) return;
    // Counter-scale bubble so text stays legible and crisp during pinch zoom
    const targetScale = Math.max(0.7, Math.min(1.4, 1 / cameraScale));
    this.bubbleContainer.scale.set(targetScale);
  }

  public destroy(): void {
    this.container.destroy({ children: true });
  }
}
