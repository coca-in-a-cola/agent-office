import { describe, expect, it } from 'bun:test';
import { Container, Rectangle, Texture, TextureSource, type Spritesheet } from 'pixi.js';
import atlas from '../../../public/assets/sample/own_tycoon_atlas.json';
import { TycoonAssetManager } from './tycoonAssets';
import { fitBounds } from './fitBounds';

// Real Pixi scene graph and production atlas rectangles; no WebGL renderer is needed
// to exercise the same getLocalBounds -> camera transform used by the component.
function room(originX = 0, originY = 0) {
  const source = new TextureSource({ width: 1024, height: 1024 });
  const textures = Object.fromEntries(Object.entries(atlas.frames).map(([name, entry]) => {
    const { x, y, w, h } = entry.frame;
    return [name, new Texture({ source, frame: new Rectangle(x, y, w, h) })];
  }));
  const sheet = { textures, animations: { miro_typing: atlas.animations.miro_typing.map(name => textures[name]) } };
  return TycoonAssetManager.buildDiorama(sheet as unknown as Spritesheet, originX, originY, 'idle');
}

describe('fitBounds with the production diorama scene graph', () => {
  for (const [width, height] of [[1280, 488], [390, 470], [320, 340], [844, 220]]) {
    it(`contains and centers all room bounds in ${width}×${height} CSS pixels`, () => {
      const { rootContainer, miroSprite } = room();
      const camera = new Container();
      camera.addChild(rootContainer);
      const bounds = rootContainer.getLocalBounds();
      const fit = fitBounds(bounds, width, height);
      camera.scale.set(fit.scale);
      camera.position.set(fit.x, fit.y);
      const result = rootContainer.getBounds();
      expect(result.minX).toBeGreaterThanOrEqual(fit.padding - 0.001);
      expect(result.minY).toBeGreaterThanOrEqual(fit.padding - 0.001);
      expect(result.maxX).toBeLessThanOrEqual(width - fit.padding + 0.001);
      expect(result.maxY).toBeLessThanOrEqual(height - fit.padding + 0.001);
      expect((result.minX + result.maxX) / 2).toBeCloseTo(width / 2);
      expect((result.minY + result.maxY) / 2).toBeCloseTo(height / 2);
      // At least one dimension fills the safe area; an arbitrary small scale fails.
      expect(Math.min(result.minX - fit.padding, result.minY - fit.padding)).toBeCloseTo(0);
      const initialTransform = [camera.x, camera.y, camera.scale.x];
      for (const textureName of atlas.animations.miro_typing) {
        const frame = atlas.frames[textureName as keyof typeof atlas.frames].frame;
        expect(frame.w).toBe(atlas.frames.miro_idle.frame.w);
        expect(frame.h).toBe(atlas.frames.miro_idle.frame.h);
        miroSprite.texture = new Texture({ source: new TextureSource({ width: frame.w, height: frame.h }) });
        const animatedBounds = rootContainer.getBounds();
        expect(animatedBounds.minX).toBeCloseTo(result.minX);
        expect(animatedBounds.maxY).toBeCloseTo(result.maxY);
      }
      expect([camera.x, camera.y, camera.scale.x]).toEqual(initialTransform);
      camera.destroy({ children: true });
    });
  }

  it('handles non-zero room origins without moving the fitted composition', () => {
    const a = room();
    const b = room(357, -213);
    const first = a.rootContainer.getLocalBounds();
    const shifted = b.rootContainer.getLocalBounds();
    const fitA = fitBounds(first, 390, 470);
    const fitB = fitBounds(shifted, 390, 470);
    expect(fitA.scale).toBeCloseTo(fitB.scale);
    expect(first.x * fitA.scale + fitA.x).toBeCloseTo(shifted.x * fitB.scale + fitB.x);
    expect(first.y * fitA.scale + fitA.y).toBeCloseTo(shifted.y * fitB.scale + fitB.y);
    a.rootContainer.destroy({ children: true });
    b.rootContainer.destroy({ children: true });
  });
});
