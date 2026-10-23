/**
 * AO-TYCOON-01 Tycoon Asset Integration Module
 *
 * Loads and manages the "Walnut & Sage" isometric sample spritesheet authored
 * by Artist-2D. Handles PixiJS v8 texture atlas lifecycle, context restoration,
 * depth-sorted diorama assembly for the 3x3 room, and Miro animation switching.
 */

import { Assets, Container, Sprite, AnimatedSprite, type Spritesheet, type Texture } from 'pixi.js';

export const TYCOON_ATLAS_URL = '/assets/sample/own_tycoon_atlas.json';
export const TYCOON_MANIFEST_URL = '/assets/sample/own_tycoon_manifest.json';

export type MiroAnimationMode = 'idle' | 'typing';

export interface TycoonFrameAnchor {
  x: number;
  y: number;
}

export interface DioramaNodeInfo {
  name: string;
  gridX?: number;
  gridY?: number;
  screenX: number;
  screenY: number;
  zIndex: number;
  anchor: TycoonFrameAnchor;
}

export interface TycoonDioramaLayout {
  originX: number;
  originY: number;
  floorTiles: DioramaNodeInfo[];
  wall: DioramaNodeInfo;
  ficus: DioramaNodeInfo;
  chair: DioramaNodeInfo;
  miro: DioramaNodeInfo;
  desk: DioramaNodeInfo;
}

/**
 * Calculates screen coordinates and depth z-index for the 3x3 diorama.
 *
 * Dimetric 2:1 Projection:
 *   screenX = originX + (gx - gy) * 32
 *   screenY = originY + (gx + gy) * 16
 *
 * Layout arrangement:
 *   - 3x3 floor tiles (gx in 0..2, gy in 0..2)
 *   - Wall cutaway (footprint 3x2, anchored at the back room apex)
 *   - Ficus at back corner (gx: 2, gy: 0.1)
 *   - Chair at (gx: 0.85, gy: 1.05)
 *   - Miro seated at (gx: 0.85, gy: 1.15) — aligned with chair, in front of backrest
 *   - Desk at (gx: 1.1, gy: 1.45) — desk edge sits over Miro's hands/lap, face stays clear
 */
export function calculateDioramaLayout(originX: number, originY: number): TycoonDioramaLayout {
  const HALF_W = 32;
  const HALF_H = 16;

  const floorTiles: DioramaNodeInfo[] = [];

  for (let gy = 0; gy < 3; gy++) {
    for (let gx = 0; gx < 3; gx++) {
      const screenX = originX + (gx - gy) * HALF_W;
      const screenY = originY + (gx + gy) * HALF_H;
      // Floor tiles stay at lowest z-tier
      const zIndex = (gx + gy) * 10;
      floorTiles.push({
        name: `floor_${gx}_${gy}`,
        gridX: gx,
        gridY: gy,
        screenX,
        screenY,
        zIndex,
        anchor: { x: 0.5, y: 0.5 },
      });
    }
  }

  // Wall cutaway: back corner apex of the 3x3 grid is gx=0, gy=0 top vertex (originX, originY - 16)
  // Wall footAnchorPx is (112, 142) on 192x160; anchor in atlas is (0.5833, 0.8875)
  // Placing at the back apex aligns the left wall along gy (3 tiles) and right wall along gx (2 tiles)
  const wall: DioramaNodeInfo = {
    name: 'wall_cutaway',
    screenX: originX,
    screenY: originY + 16,
    zIndex: 100,
    anchor: { x: 112 / 192, y: 142 / 160 },
  };

  // Ficus: placed near back-right corner of the room (around gx: 2.1, gy: 0.2)
  const ficusScreenX = originX + (2.05 - 0.2) * HALF_W;
  const ficusScreenY = originY + (2.05 + 0.2) * HALF_H;
  const ficus: DioramaNodeInfo = {
    name: 'ficus',
    gridX: 2.05,
    gridY: 0.2,
    screenX: ficusScreenX,
    screenY: ficusScreenY,
    zIndex: 150,
    anchor: { x: 56 / 112, y: 141 / 160 },
  };

  // Chair: workspace seating behind desk
  const chairGX = 0.85;
  const chairGY = 1.0;
  const chairScreenX = originX + (chairGX - chairGY) * HALF_W;
  const chairScreenY = originY + (chairGX + chairGY) * HALF_H;
  const chair: DioramaNodeInfo = {
    name: 'chair_teal',
    gridX: chairGX,
    gridY: chairGY,
    screenX: chairScreenX,
    screenY: chairScreenY,
    zIndex: 200,
    anchor: { x: 56 / 112, y: 104 / 128 },
  };

  // Miro: sits in the chair, slightly forward in Y so chair backrest is behind Miro
  const miroGX = 0.85;
  const miroGY = 1.08;
  const miroScreenX = originX + (miroGX - miroGY) * HALF_W;
  const miroScreenY = originY + (miroGX + miroGY) * HALF_H;
  const miro: DioramaNodeInfo = {
    name: 'miro',
    gridX: miroGX,
    gridY: miroGY,
    screenX: miroScreenX,
    screenY: miroScreenY,
    zIndex: 250,
    anchor: { x: 40 / 80, y: 103 / 112 },
  };

  // Desk: placed in front of Miro, centered on tile (1.1, 1.45)
  // Desk footprint is 2x1 tiles. Desk surface naturally overlaps Miro's hands/lap
  // while Miro's head and monitor stay unobscured.
  const deskGX = 1.1;
  const deskGY = 1.45;
  const deskScreenX = originX + (deskGX - deskGY) * HALF_W;
  const deskScreenY = originY + (deskGX + deskGY) * HALF_H;
  const desk: DioramaNodeInfo = {
    name: 'desk_wood',
    gridX: deskGX,
    gridY: deskGY,
    screenX: deskScreenX,
    screenY: deskScreenY,
    zIndex: 300,
    anchor: { x: 80 / 160, y: 118 / 144 },
  };

  return {
    originX,
    originY,
    floorTiles,
    wall,
    ficus,
    chair,
    miro,
    desk,
  };
}

export class TycoonAssetManager {
  private static cachedSheet: Spritesheet | null = null;
  private static loadPromise: Promise<Spritesheet> | null = null;
  private static activeConsumers = 0;

  /**
   * Returns current active consumer count (for testing/diagnostics).
   */
  public static getActiveConsumers(): number {
    return this.activeConsumers;
  }

  /**
   * Returns whether the atlas is currently cached in memory.
   */
  public static isLoaded(): boolean {
    return this.cachedSheet !== null;
  }

  /**
   * Resets internal state for test isolation.
   */
  public static resetForTesting(): void {
    this.cachedSheet = null;
    this.loadPromise = null;
    this.activeConsumers = 0;
  }

  /**
   * Loads or returns the cached spritesheet.
   * If forceReload is true (e.g. during WebGL context loss recovery),
   * the cached asset is evicted and re-created cleanly without breaking
   * other shared assets.
   */
  public static async loadAtlas(forceReload = false): Promise<Spritesheet> {
    if (forceReload) {
      await this.unloadAtlas(true);
    } else {
      this.activeConsumers++;
    }

    if (this.cachedSheet && !forceReload) {
      return this.cachedSheet;
    }

    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = (async () => {
      try {
        const sheet = await Assets.load<Spritesheet>(TYCOON_ATLAS_URL);
        if (!sheet || !sheet.textures) {
          throw new Error('Loaded atlas is empty or invalid');
        }
        this.cachedSheet = sheet;
        return sheet;
      } catch (err) {
        this.cachedSheet = null;
        if (!forceReload) {
          this.activeConsumers = Math.max(0, this.activeConsumers - 1);
        }
        throw err;
      } finally {
        this.loadPromise = null;
      }
    })();

    return this.loadPromise;
  }

  /**
   * Safely unloads the Tycoon atlas from Pixi Assets cache if loaded.
   * Uses reference counting so active consumers are not broken by premature unloads.
   * If force is true (e.g. context loss recovery), unloads immediately.
   */
  public static async unloadAtlas(force = false): Promise<void> {
    if (!force) {
      this.activeConsumers = Math.max(0, this.activeConsumers - 1);
      if (this.activeConsumers > 0) {
        return;
      }
    }

    // Await any pending load so Assets.load and Assets.unload do not race
    if (this.loadPromise) {
      try {
        await this.loadPromise;
      } catch {
        // Ignore load failure during teardown
      }
    }

    // If new consumers mounted while load was settling, keep cache intact
    if (!force && this.activeConsumers > 0) {
      return;
    }

    this.cachedSheet = null;
    this.loadPromise = null;

    try {
      if (Assets.cache.has(TYCOON_ATLAS_URL)) {
        await Assets.unload(TYCOON_ATLAS_URL);
      }
    } catch (e) {
      console.warn('Error during atlas unloading:', e);
    }
  }

  /**
   * Builds the complete Tycoon diorama scene into a Pixi Container.
   */
  public static buildDiorama(
    sheet: Spritesheet,
    originX: number,
    originY: number,
    animationMode: MiroAnimationMode = 'typing'
  ): {
    rootContainer: Container;
    miroSprite: AnimatedSprite | Sprite;
    setAnimationMode: (mode: MiroAnimationMode) => void;
  } {
    const rootContainer = new Container();
    rootContainer.sortableChildren = true;

    const layout = calculateDioramaLayout(originX, originY);

    // 1. Floor tiles
    const floorTexture = sheet.textures['floor_sage'];
    if (floorTexture) {
      for (const tile of layout.floorTiles) {
        const sprite = new Sprite(floorTexture);
        sprite.anchor.set(tile.anchor.x, tile.anchor.y);
        sprite.position.set(tile.screenX, tile.screenY);
        sprite.zIndex = tile.zIndex;
        rootContainer.addChild(sprite);
      }
    }

    // 2. Wall cutaway
    const wallTexture = sheet.textures['wall_cutaway'];
    if (wallTexture) {
      const wallSprite = new Sprite(wallTexture);
      wallSprite.anchor.set(layout.wall.anchor.x, layout.wall.anchor.y);
      wallSprite.position.set(layout.wall.screenX, layout.wall.screenY);
      wallSprite.zIndex = layout.wall.zIndex;
      rootContainer.addChild(wallSprite);
    }

    // 3. Ficus
    const ficusTexture = sheet.textures['ficus'];
    if (ficusTexture) {
      const ficusSprite = new Sprite(ficusTexture);
      ficusSprite.anchor.set(layout.ficus.anchor.x, layout.ficus.anchor.y);
      ficusSprite.position.set(layout.ficus.screenX, layout.ficus.screenY);
      ficusSprite.zIndex = layout.ficus.zIndex;
      rootContainer.addChild(ficusSprite);
    }

    // 4. Chair
    const chairTexture = sheet.textures['chair_teal'];
    if (chairTexture) {
      const chairSprite = new Sprite(chairTexture);
      chairSprite.anchor.set(layout.chair.anchor.x, layout.chair.anchor.y);
      chairSprite.position.set(layout.chair.screenX, layout.chair.screenY);
      chairSprite.zIndex = layout.chair.zIndex;
      rootContainer.addChild(chairSprite);
    }

    // 5. Miro animated character
    const idleTexture = sheet.textures['miro_idle'];
    const typingTextures = sheet.animations?.['miro_typing'] ?? [
      sheet.textures['miro_typing_01'] ?? idleTexture,
      sheet.textures['miro_typing_02'] ?? idleTexture,
    ];

    const miroSprite = new AnimatedSprite(
      animationMode === 'typing' ? typingTextures : [idleTexture]
    );
    miroSprite.anchor.set(layout.miro.anchor.x, layout.miro.anchor.y);
    miroSprite.position.set(layout.miro.screenX, layout.miro.screenY);
    miroSprite.zIndex = layout.miro.zIndex;
    // Manifest specifies 6 fps for typing animation
    miroSprite.animationSpeed = 6 / 60; // 6 fps at 60 fps base
    miroSprite.loop = true;
    if (animationMode === 'typing') {
      miroSprite.play();
    } else {
      miroSprite.stop();
    }
    rootContainer.addChild(miroSprite);

    const setAnimationMode = (mode: MiroAnimationMode) => {
      if (mode === 'typing') {
        miroSprite.textures = typingTextures as Texture[];
        miroSprite.animationSpeed = 6 / 60;
        miroSprite.loop = true;
        miroSprite.play();
      } else {
        miroSprite.stop();
        miroSprite.textures = [idleTexture] as Texture[];
      }
    };

    // 6. Desk (layered over Miro's hands/lap)
    const deskTexture = sheet.textures['desk_wood'];
    if (deskTexture) {
      const deskSprite = new Sprite(deskTexture);
      deskSprite.anchor.set(layout.desk.anchor.x, layout.desk.anchor.y);
      deskSprite.position.set(layout.desk.screenX, layout.desk.screenY);
      deskSprite.zIndex = layout.desk.zIndex;
      rootContainer.addChild(deskSprite);
    }

    return {
      rootContainer,
      miroSprite,
      setAnimationMode,
    };
  }
}
