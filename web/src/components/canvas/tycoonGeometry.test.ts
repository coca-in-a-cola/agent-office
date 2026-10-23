import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { calculateDioramaLayout, type DioramaNodeInfo } from './tycoonAssets';
import atlas from '../../../public/assets/sample/own_tycoon_atlas.json';
import manifest from '../../../public/assets/sample/own_tycoon_manifest.json';

const source = (name: string) => readFileSync(new URL(`../../../../assets_src/vector/own_tycoon_sample/${name}.svg`, import.meta.url), 'utf8');
type Point = [number, number];
const polygons = (name: string): Point[][] => [...source(name).matchAll(/<polygon points="([^"]+)"/g)].map(m => m[1].split(' ').map(p => p.split(',').map(Number) as Point));
const layout = calculateDioramaLayout(320, 240);
function world(node: DioramaNodeInfo, frame: {w: number; h: number}, p: Point): Point {
  return [p[0] + node.screenX - node.anchor.x * frame.w, p[1] + node.screenY - node.anchor.y * frame.h];
}
const key = (p: Point) => p.join(',');
const edge = (a: Point, b: Point) => [key(a), key(b)].sort().join('|');

describe('Production atlas/source geometry (not mocked sprite dimensions)', () => {
  it('joins all twelve internal floor edges exactly using real 64x32 frames and center anchors', () => {
    const frame = atlas.frames.floor_sage.frame;
    expect([frame.w, frame.h]).toEqual([64, 32]);
    const diamond = polygons('floor_sage')[0];
    expect(diamond).toEqual([[0,16],[32,0],[64,16],[32,32]]);
    const edges = new Map<string, number>();
    for (const tile of layout.floorTiles) {
      expect(tile.anchor).toEqual({x: .5, y: .5});
      const points = diamond.map(p => world(tile, frame, p));
      points.forEach((p, i) => { const e = edge(p, points[(i+1)%4]); edges.set(e, (edges.get(e) ?? 0) + 1); });
    }
    expect([...edges.values()].filter(n => n === 2)).toHaveLength(12);
    expect([...edges.values()].filter(n => n === 1)).toHaveLength(12);
    expect(Math.max(...edges.values())).toBe(2);
  });

  it('wall source has a concave BACK junction and exactly follows both 3-tile floor boundaries', () => {
    const frame = atlas.frames.wall_cutaway.frame;
    const anchor = manifest.frames.wall_cutaway.footAnchorPx as Point;
    expect(layout.wall.anchor).toEqual(atlas.frames.wall_cutaway.anchor);
    expect(world(layout.wall, frame, anchor)).toEqual([320,224]);
    const faces = polygons('wall_cutaway').slice(1,3);
    // Test the real drawn wall bottoms, not a duplicated layout formula.
    const left = faces[0].slice(2).map(p => world(layout.wall, frame, p));
    const right = faces[1].slice(2).map(p => world(layout.wall, frame, p));
    expect(left).toEqual([[320,224],[224,272]]);
    expect(right).toEqual([[416,272],[320,224]]);
    expect(left[1][1]).toBeGreaterThan(left[0][1]);
    expect(right[0][1]).toBeGreaterThan(right[1][1]);
    const floorFrame = atlas.frames.floor_sage.frame;
    const diamond = polygons('floor_sage')[0];
    for (const tile of layout.floorTiles) {
      if (tile.gridX !== 0 && tile.gridY !== 0) continue;
      const points = diamond.map(p => world(tile, floorFrame, p));
      const boundary = tile.gridX === 0 ? [points[0],points[1]] : [points[1],points[2]];
      for (const [x,y] of boundary) expect(y).toBe(224 + Math.abs(x-320)/2);
    }
  });

  it('uses an exact 2x1 desk plane, shared front registration, and hands-above-desktop ordering', () => {
    const top = polygons('desk_wood').find(p => JSON.stringify(p) === JSON.stringify([[32,72],[64,56],[128,88],[96,104]]));
    expect(top).toBeDefined();
    expect(manifest.frames.desk_wood.footprintTiles).toEqual([2,1]);
    expect(layout.desk.anchor).toEqual(atlas.frames.desk_wood.anchor);
    expect(layout.deskFront.anchor).toEqual(atlas.frames.desk_front.anchor);
    expect(layout.deskFront.screenX).toBe(layout.desk.screenX);
    expect(layout.deskFront.screenY).toBe(layout.desk.screenY);
    expect(layout.chair.screenX).toBe(layout.miro.screenX);
    expect(layout.chair.screenY).toBe(layout.miro.screenY);
    expect(layout.desk.zIndex).toBeLessThan(layout.miro.zIndex);
    expect(layout.miro.zIndex).toBeLessThan(layout.deskFront.zIndex);
    expect(manifest.animation.typing.fps).toBe(6);
    expect(atlas.animations.miro_typing).toHaveLength(2);
  });
});
