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
  deskFront: DioramaNodeInfo;
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
 *   - Concave wall returns span the two complete 3-tile back edges.
 *   - Ficus at (2, 0.05), with subordinate authored foliage scale
 *   - Chair and Miro share (0.35, 1.15), in front of the backrest
 *   - 2x1 desk at (1.05, 1.45); hands above desktop, lap behind apron
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
  // Interior foot (112,88) on 224x160; both endpoints descend 48px.
  // This is a concave back corner, not the old convex outer elbow.
  const wall: DioramaNodeInfo = {
    name: 'wall_cutaway',
    screenX: originX,
    screenY: originY - 16,
    zIndex: 100,
    anchor: { x: 112 / 224, y: 88 / 160 },
  };

  // Ficus: separated from the face and monitor near the back-right boundary.
  const ficusScreenX = originX + (2.0 - 0.05) * HALF_W;
  const ficusScreenY = originY + (2.0 + 0.05) * HALF_H;
  const ficus: DioramaNodeInfo = {
    name: 'ficus',
    gridX: 2.0,
    gridY: 0.05,
    screenX: ficusScreenX,
    screenY: ficusScreenY,
    zIndex: 150,
    anchor: { x: 56 / 112, y: 141 / 160 },
  };

  // Chair: workspace seating behind desk
  const chairGX = 0.35;
  const chairGY = 1.15;
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

  // Miro: same ground registration as the chair, drawn in front of backrest.
  const miroGX = 0.35;
  const miroGY = 1.15;
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

  // Exact 2x1 desktop: behind the hands; separate foreground apron masks lap.
  const deskGX = 1.05;
  const deskGY = 1.45;
  const deskScreenX = originX + (deskGX - deskGY) * HALF_W;
  const deskScreenY = originY + (deskGX + deskGY) * HALF_H;
  const desk: DioramaNodeInfo = {
    name: 'desk_wood',
    gridX: deskGX,
    gridY: deskGY,
    screenX: deskScreenX,
    screenY: deskScreenY,
    zIndex: 240,
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
    deskFront: { ...desk, name: 'desk_front', zIndex: 300 },
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

    // 6. Desktop behind hands; the separate apron masks the lap only.
    const deskTexture = sheet.textures['desk_wood'];
    if (deskTexture) {
      const deskSprite = new Sprite(deskTexture);
      deskSprite.anchor.set(layout.desk.anchor.x, layout.desk.anchor.y);
      deskSprite.position.set(layout.desk.screenX, layout.desk.screenY);
      deskSprite.zIndex = layout.desk.zIndex;
      rootContainer.addChild(deskSprite);
    }

    const frontTexture = sheet.textures['desk_front'];
    if (frontTexture) {
      const front = new Sprite(frontTexture);
      front.anchor.set(layout.deskFront.anchor.x, layout.deskFront.anchor.y);
      front.position.set(layout.deskFront.screenX, layout.deskFront.screenY);
      front.zIndex = layout.deskFront.zIndex;
      rootContainer.addChild(front);
    }

    return {
      rootContainer,
      miroSprite,
      setAnimationMode,
    };
  }
}
