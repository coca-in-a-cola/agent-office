import { describe, expect, it } from 'bun:test';
import {
  createOfficeRoomLayout,
  getOccupiedTileMask,
  hitTestSceneItem,
  AGENT_CONFIGS,
} from './OfficeRoomScene';

describe('OfficeRoomScene', () => {
  describe('createOfficeRoomLayout', () => {
    it('generates exactly 64 floor tiles for an 8x8 grid with correct zones', () => {
      const layout = createOfficeRoomLayout(8, 8, 0, 0);
      expect(layout.floorTiles).toHaveLength(64);

      // Verify carpet vs parquet zones
      for (const tile of layout.floorTiles) {
        if (tile.gx >= 6 && tile.gy >= 6) {
          expect(tile.zone).toBe('parquet');
          expect(tile.tint).toBe(0xd4a373);
        } else {
          expect(tile.zone).toBe('carpet');
          expect(tile.tint).toBe(0xffffff);
        }
      }
    });

    it('contains all 6 agents with unique non-overlapping coordinates in AGENT_CONFIGS', () => {
      expect(AGENT_CONFIGS).toHaveLength(6);
      const expectedIds = ['tyler', 'coder', 'webdev', 'artist', 'devops', 'qa'];
      const actualIds = AGENT_CONFIGS.map((a) => a.id);
      expect(actualIds).toEqual(expectedIds);

      const positions = new Set<string>();
      for (const agent of AGENT_CONFIGS) {
        const key = `${agent.deskGX},${agent.deskGY}`;
        expect(positions.has(key)).toBe(false);
        positions.add(key);
      }
    });

    it('creates workstations for each agent with valid screen and z-index values', () => {
      const layout = createOfficeRoomLayout(8, 8, 0, 0);
      expect(layout.workstations).toHaveLength(6);

      for (const ws of layout.workstations) {
        expect(ws.zIndexDesktop).toBeGreaterThan(0);
        expect(ws.zIndexAgent).toBeGreaterThan(ws.zIndexDesktop - 20);
        expect(typeof ws.deskScreenX).toBe('number');
        expect(typeof ws.deskScreenY).toBe('number');
      }
    });

    it('includes perimeter cutaway wall and decor props', () => {
      const layout = createOfficeRoomLayout(8, 8, 0, 0);
      expect(layout.walls.length).toBeGreaterThan(0);
      expect(layout.walls[0].wallId).toBe('wall_cutaway_north');
      expect(layout.decor.length).toBe(2);
      expect(layout.decor.some((d) => d.id === 'ficus_east')).toBe(true);
      expect(layout.decor.some((d) => d.id === 'ficus_west')).toBe(true);
    });
  });

  describe('getOccupiedTileMask', () => {
    it('flags perimeter walls and desk tiles as blocked and walking paths as open', () => {
      const layout = createOfficeRoomLayout(8, 8, 0, 0);
      const mask = getOccupiedTileMask(layout);

      expect(mask).toHaveLength(8);
      expect(mask[0]).toHaveLength(8);

      // Perimeter walls: row 0 and col 0 are blocked
      for (let x = 0; x < 8; x++) {
        expect(mask[0][x]).toBe(true);
      }
      for (let y = 0; y < 8; y++) {
        expect(mask[y][0]).toBe(true);
      }

      // Desks should be blocked: e.g. Tyler at (2.0, 1.8) -> occupies y=1..2, x=1..2
      expect(mask[1][2]).toBe(true);
      expect(mask[2][2]).toBe(true);

      // Open walking hallway tile (e.g. center aisle tile (3, 3) or (4, 3))
      // Workstations are at gx: 2.0 and 5.5.
      // So at gx=3 or 4, gy=3 should be open
      expect(mask[3][4]).toBe(false);
      expect(mask[4][4]).toBe(false);
    });
  });

  describe('calculateDepthZ', () => {
    it('guarantees that deeper workstations (higher gx+gy) have strictly higher z-indexes', () => {
      const layout = createOfficeRoomLayout(8, 8, 0, 0);
      const tyler = layout.workstations.find((w) => w.agentId === 'tyler')!;
      const devops = layout.workstations.find((w) => w.agentId === 'devops')!;
      const qa = layout.workstations.find((w) => w.agentId === 'qa')!;

      // Tyler (2.0, 1.8) is near north corner, DevOps (2.0, 7.2) is further south
      expect(devops.zIndexDesktop).toBeGreaterThan(tyler.zIndexDesktop);
      // QA (5.5, 7.2) is deeper than DevOps (2.0, 7.2)
      expect(qa.zIndexDesktop).toBeGreaterThan(devops.zIndexDesktop);
    });
  });

  describe('hitTestSceneItem', () => {
    it('accurately identifies agent workstations when clicked inside desk diamonds', () => {
      const layout = createOfficeRoomLayout(8, 8, 0, 0);
      const tyler = layout.workstations.find((w) => w.agentId === 'tyler')!;

      // Exact desk screen coordinate should hit Tyler
      const hit = hitTestSceneItem(tyler.deskScreenX, tyler.deskScreenY, layout);
      expect(hit.type).toBe('agent');
      expect(hit.id).toBe('tyler');
    });

    it('identifies decor when clicked on decor positions', () => {
      const layout = createOfficeRoomLayout(8, 8, 0, 0);
      const ficus = layout.decor.find((d) => d.id === 'ficus_east')!;

      const hit = hitTestSceneItem(ficus.screenX, ficus.screenY, layout);
      expect(hit.type).toBe('decor');
      expect(hit.id).toBe('ficus_east');
    });

    it('identifies floor tiles when clicking in open floor space', () => {
      const layout = createOfficeRoomLayout(8, 8, 0, 0);
      // Find a tile in the open area far from desk diamonds
      // tile (4, 3)
      const tile = layout.floorTiles.find((t) => t.gx === 4 && t.gy === 3)!;
      const hit = hitTestSceneItem(tile.screenX, tile.screenY, layout);
      expect(hit.type).toBe('floor');
      expect(hit.id).toBe('4_3');
    });

    it('returns none when clicked far outside the bounds', () => {
      const layout = createOfficeRoomLayout(8, 8, 0, 0);
      const hit = hitTestSceneItem(9999, 9999, layout);
      expect(hit.type).toBe('none');
    });
  });
});
