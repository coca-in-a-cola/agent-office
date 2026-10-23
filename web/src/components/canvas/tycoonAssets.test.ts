import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Assets, type Spritesheet } from 'pixi.js';
import {
  TycoonAssetManager,
  TYCOON_ATLAS_URL,
  calculateDioramaLayout,
} from './tycoonAssets';

function createMockSheet(label = 'default'): Spritesheet {
  return {
    textures: {
      floor_sage: { label: `floor_${label}` } as any,
      wall_cutaway: { label: `wall_${label}` } as any,
      ficus: { label: `ficus_${label}` } as any,
      chair_teal: { label: `chair_${label}` } as any,
      miro_idle: { label: `idle_${label}` } as any,
      miro_typing_01: { label: `typing1_${label}` } as any,
      miro_typing_02: { label: `typing2_${label}` } as any,
      desk_wood: { label: `desk_${label}` } as any,
    },
    animations: {
      miro_typing: [
        { label: `typing1_${label}` } as any,
        { label: `typing2_${label}` } as any,
      ],
    },
    data: {} as any,
  } as unknown as Spritesheet;
}

describe('AO-TYCOON-01: TycoonAssetManager regression suite', () => {
  let originalLoad: typeof Assets.load;
  let originalUnload: typeof Assets.unload;
  let originalCacheHas: typeof Assets.cache.has;

  let loadedUrls: string[] = [];
  let unloadedUrls: string[] = [];
  let cacheKeys: Set<string> = new Set();
  let mockLoadImpl: (url: string) => Promise<any>;

  beforeEach(() => {
    TycoonAssetManager.resetForTesting();
    loadedUrls = [];
    unloadedUrls = [];
    cacheKeys = new Set();

    originalLoad = Assets.load;
    originalUnload = Assets.unload;
    originalCacheHas = Assets.cache.has;

    mockLoadImpl = async (url: string) => {
      loadedUrls.push(url);
      cacheKeys.add(url);
      return createMockSheet('v1');
    };

    Assets.load = ((url: string) => mockLoadImpl(url)) as any;
    Assets.unload = (async (url: string) => {
      unloadedUrls.push(url);
      cacheKeys.delete(url);
    }) as any;
    Assets.cache.has = ((url: string) => cacheKeys.has(url)) as any;
  });

  afterEach(() => {
    TycoonAssetManager.resetForTesting();
    Assets.load = originalLoad;
    Assets.unload = originalUnload;
    Assets.cache.has = originalCacheHas;
  });

  it('calculates deterministic diorama layout for 3x3 isometric room', () => {
    const layout = calculateDioramaLayout(320, 240);
    expect(layout.originX).toBe(320);
    expect(layout.originY).toBe(240);
    expect(layout.floorTiles.length).toBe(9);
    expect(layout.wall.name).toBe('wall_cutaway');
    expect(layout.chair.name).toBe('chair_teal');
    expect(layout.miro.name).toBe('miro');
    expect(layout.desk.name).toBe('desk_wood');
    expect(layout.ficus.name).toBe('ficus');

    // Miro sits behind desk and in front of chair
    expect(layout.chair.zIndex).toBeLessThan(layout.miro.zIndex);
    expect(layout.miro.zIndex).toBeLessThan(layout.desk.zIndex);
  });

  it('tracks activeConsumers refcount accurately across load and unload', async () => {
    expect(TycoonAssetManager.getActiveConsumers()).toBe(0);
    expect(TycoonAssetManager.isLoaded()).toBe(false);

    // First consumer mounts
    const sheet1 = await TycoonAssetManager.loadAtlas();
    expect(TycoonAssetManager.getActiveConsumers()).toBe(1);
    expect(TycoonAssetManager.isLoaded()).toBe(true);
    expect(loadedUrls).toEqual([TYCOON_ATLAS_URL]);
    expect(sheet1).toBeDefined();

    // Second consumer mounts (shared)
    const sheet2 = await TycoonAssetManager.loadAtlas();
    expect(TycoonAssetManager.getActiveConsumers()).toBe(2);
    expect(sheet2).toBe(sheet1);
    // Should NOT have triggered a second Assets.load call
    expect(loadedUrls.length).toBe(1);

    // First consumer unmounts
    await TycoonAssetManager.unloadAtlas();
    expect(TycoonAssetManager.getActiveConsumers()).toBe(1);
    expect(TycoonAssetManager.isLoaded()).toBe(true);
    expect(unloadedUrls.length).toBe(0);

    // Second consumer unmounts
    await TycoonAssetManager.unloadAtlas();
    expect(TycoonAssetManager.getActiveConsumers()).toBe(0);
    expect(TycoonAssetManager.isLoaded()).toBe(false);
    expect(unloadedUrls).toEqual([TYCOON_ATLAS_URL]);
  });

  it('ensures shared consumer unload does not destroy assets for remaining consumers', async () => {
    const sheetC1 = await TycoonAssetManager.loadAtlas();
    await TycoonAssetManager.loadAtlas();
    await TycoonAssetManager.loadAtlas();

    expect(TycoonAssetManager.getActiveConsumers()).toBe(3);

    // Unload consumer 1
    await TycoonAssetManager.unloadAtlas();
    expect(TycoonAssetManager.getActiveConsumers()).toBe(2);
    expect(TycoonAssetManager.isLoaded()).toBe(true);
    expect(unloadedUrls.length).toBe(0);

    // Consumer 2 re-requests atlas - receives identical cached sheet
    const sheetC2Check = await TycoonAssetManager.loadAtlas();
    expect(sheetC2Check).toBe(sheetC1);
    expect(TycoonAssetManager.getActiveConsumers()).toBe(3);

    // Unload consumer 2, 3 and extra reference
    await TycoonAssetManager.unloadAtlas();
    await TycoonAssetManager.unloadAtlas();
    expect(TycoonAssetManager.getActiveConsumers()).toBe(1);
    expect(TycoonAssetManager.isLoaded()).toBe(true);
    expect(unloadedUrls.length).toBe(0);

    // Last consumer unloads -> tears down
    await TycoonAssetManager.unloadAtlas();
    expect(TycoonAssetManager.getActiveConsumers()).toBe(0);
    expect(TycoonAssetManager.isLoaded()).toBe(false);
    expect(unloadedUrls).toEqual([TYCOON_ATLAS_URL]);
  });

  it('awaits in-flight load during unload to avoid race conditions', async () => {
    let resolveLoad!: (sheet: Spritesheet) => void;
    mockLoadImpl = () =>
      new Promise<Spritesheet>((resolve) => {
        resolveLoad = resolve;
      });

    // Start load but don't resolve yet
    const loadPromise = TycoonAssetManager.loadAtlas();
    expect(TycoonAssetManager.getActiveConsumers()).toBe(1);
    expect(TycoonAssetManager.isLoaded()).toBe(false);

    // Unload is initiated while load is still pending
    let unloadFinished = false;
    const unloadPromise = TycoonAssetManager.unloadAtlas().then(() => {
      unloadFinished = true;
    });

    // Unload must await loadPromise and not finish immediately
    await new Promise((r) => setTimeout(r, 15));
    expect(unloadFinished).toBe(false);

    // Now resolve the pending load
    cacheKeys.add(TYCOON_ATLAS_URL);
    resolveLoad(createMockSheet('v1'));

    await loadPromise;
    await unloadPromise;

    expect(unloadFinished).toBe(true);
    expect(TycoonAssetManager.getActiveConsumers()).toBe(0);
    expect(TycoonAssetManager.isLoaded()).toBe(false);
    expect(unloadedUrls).toEqual([TYCOON_ATLAS_URL]);
  });

  it('keeps cache intact if a new consumer mounts while pending load settles during unload', async () => {
    let resolveLoad!: (sheet: Spritesheet) => void;
    mockLoadImpl = () =>
      new Promise<Spritesheet>((resolve) => {
        resolveLoad = resolve;
      });

    // Consumer 1 begins load
    const load1 = TycoonAssetManager.loadAtlas();
    expect(TycoonAssetManager.getActiveConsumers()).toBe(1);

    // Consumer 1 unloads (decrements activeConsumers to 0, awaits in-flight load)
    const unload1 = TycoonAssetManager.unloadAtlas();

    // Consumer 2 mounts while load is still in flight (activeConsumers increments to 1)
    const load2 = TycoonAssetManager.loadAtlas();
    expect(TycoonAssetManager.getActiveConsumers()).toBe(1);

    cacheKeys.add(TYCOON_ATLAS_URL);
    resolveLoad(createMockSheet('v1'));

    const [sheet1, sheet2] = await Promise.all([load1, load2, unload1]);

    expect(sheet1).toBe(sheet2);
    // Because consumer 2 mounted, unload1 did NOT evict the cache
    expect(TycoonAssetManager.getActiveConsumers()).toBe(1);
    expect(TycoonAssetManager.isLoaded()).toBe(true);
    expect(unloadedUrls.length).toBe(0);
  });

  it('handles load error, rolls back activeConsumers refcount, and allows retry', async () => {
    let shouldFail = true;
    mockLoadImpl = async (url: string) => {
      if (shouldFail) {
        throw new Error('Network timeout downloading atlas');
      }
      cacheKeys.add(url);
      return createMockSheet('recovered');
    };

    // First load attempt fails
    await expect(TycoonAssetManager.loadAtlas()).rejects.toThrow(
      'Network timeout downloading atlas'
    );

    // Refcount must be rolled back to 0 on failure
    expect(TycoonAssetManager.getActiveConsumers()).toBe(0);
    expect(TycoonAssetManager.isLoaded()).toBe(false);

    // Retry succeeds
    shouldFail = false;
    const sheet = await TycoonAssetManager.loadAtlas();
    expect(sheet).toBeDefined();
    expect(TycoonAssetManager.getActiveConsumers()).toBe(1);
    expect(TycoonAssetManager.isLoaded()).toBe(true);
  });

  it('rejects invalid or empty atlas and cleans up activeConsumers', async () => {
    mockLoadImpl = async () => ({}) as any; // Invalid atlas missing textures

    await expect(TycoonAssetManager.loadAtlas()).rejects.toThrow(
      'Loaded atlas is empty or invalid'
    );
    expect(TycoonAssetManager.getActiveConsumers()).toBe(0);
    expect(TycoonAssetManager.isLoaded()).toBe(false);
  });

  it('supports forced reload semantics to cleanly rebuild cache (context loss recovery)', async () => {
    // Initial load
    const sheetV1 = await TycoonAssetManager.loadAtlas();
    expect(TycoonAssetManager.getActiveConsumers()).toBe(1);
    expect(sheetV1).toBeDefined();

    // Setup mock to return a new sheet instance for reload
    mockLoadImpl = async (url: string) => {
      loadedUrls.push(url);
      cacheKeys.add(url);
      return createMockSheet('v2');
    };

    // Force reload simulates WebGL context loss recovery
    const sheetV2 = await TycoonAssetManager.loadAtlas(true);

    expect(unloadedUrls).toContain(TYCOON_ATLAS_URL);
    expect(loadedUrls.length).toBe(2);
    expect(sheetV2).not.toBe(sheetV1);
    expect(TycoonAssetManager.isLoaded()).toBe(true);
    // Consumer count should still be 1 (bypassed normal increment for force reload)
    expect(TycoonAssetManager.getActiveConsumers()).toBe(1);
  });

  it('supports forced unload immediately disregarding refcount', async () => {
    await TycoonAssetManager.loadAtlas();
    await TycoonAssetManager.loadAtlas();
    expect(TycoonAssetManager.getActiveConsumers()).toBe(2);

    // Force unload directly
    await TycoonAssetManager.unloadAtlas(true);

    expect(TycoonAssetManager.isLoaded()).toBe(false);
    expect(unloadedUrls).toContain(TYCOON_ATLAS_URL);
  });
});
