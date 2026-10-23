import { describe, it, expect } from 'bun:test';
import {
  FURNITURE_CATALOG,
  getFootprintTiles,
  canPlaceFurniture,
  updateWalkabilityMask,
  findPlacedFurnitureAt,
  getNextRotation,
  type PlacedFurnitureItem,
  type RoomGridDimensions,
} from './footprintEngine';

describe('AO-TYCOON-05: footprintEngine', () => {
  const roomGrid: RoomGridDimensions = { width: 8, height: 8 };

  // Perimeter walls blocked mask (row 0 and col 0 blocked)
  const blockedWallsMask: boolean[][] = Array.from({ length: 8 }, (_, y) =>
    Array.from({ length: 8 }, (_, x) => x === 0 || y === 0)
  );

  describe('getFootprintTiles & Rotation', () => {
    it('calculates tiles for 2x1 desk at 0° and 180° (horizontal 2x1)', () => {
      const desk = FURNITURE_CATALOG.desk_wood;
      const tiles0 = getFootprintTiles(2, 2, desk, 0);
      expect(tiles0).toEqual([{ x: 2, y: 2 }, { x: 3, y: 2 }]);

      const tiles180 = getFootprintTiles(2, 2, desk, 180);
      expect(tiles180).toEqual([{ x: 2, y: 2 }, { x: 3, y: 2 }]);
    });

    it('calculates tiles for 2x1 desk at 90° and 270° (vertical 1x2)', () => {
      const desk = FURNITURE_CATALOG.desk_wood;
      const tiles90 = getFootprintTiles(2, 2, desk, 90);
      expect(tiles90).toEqual([{ x: 2, y: 2 }, { x: 2, y: 3 }]);

      const tiles270 = getFootprintTiles(2, 2, desk, 270);
      expect(tiles270).toEqual([{ x: 2, y: 2 }, { x: 2, y: 3 }]);
    });

    it('cycles rotation 90° clockwise correctly via getNextRotation', () => {
      expect(getNextRotation(0)).toBe(90);
      expect(getNextRotation(90)).toBe(180);
      expect(getNextRotation(180)).toBe(270);
      expect(getNextRotation(270)).toBe(0);
    });
  });

  describe('canPlaceFurniture Collision Checks', () => {
    it('allows placing 2x1 desk in valid open floor area', () => {
      const desk = FURNITURE_CATALOG.desk_wood;
      const res = canPlaceFurniture(2, 2, desk, 0, roomGrid, [], blockedWallsMask);
      expect(res.valid).toBe(true);
      expect(res.occupiedTiles).toHaveLength(2);
    });

    it('rejects placement when out of room grid bounds', () => {
      const desk = FURNITURE_CATALOG.desk_wood;
      // Placement extending past right edge (x=7, width=2 -> x=7,8 out of 8)
      const resRight = canPlaceFurniture(7, 2, desk, 0, roomGrid, [], blockedWallsMask);
      expect(resRight.valid).toBe(false);
      expect(resRight.reason).toBe('out_of_bounds');

      // Negative coordinates
      const resNeg = canPlaceFurniture(-1, 2, desk, 0, roomGrid, [], blockedWallsMask);
      expect(resNeg.valid).toBe(false);
      expect(resNeg.reason).toBe('out_of_bounds');
    });

    it('rejects placement overlapping perimeter walls', () => {
      const desk = FURNITURE_CATALOG.desk_wood;
      // Overlapping north wall (y=0)
      const resNorth = canPlaceFurniture(2, 0, desk, 0, roomGrid, [], blockedWallsMask);
      expect(resNorth.valid).toBe(false);
      expect(resNorth.reason).toBe('wall_collision');

      // Overlapping west wall (x=0)
      const resWest = canPlaceFurniture(0, 2, desk, 0, roomGrid, [], blockedWallsMask);
      expect(resWest.valid).toBe(false);
      expect(resWest.reason).toBe('wall_collision');
    });

    it('rejects placement overlapping existing furniture item', () => {
      const desk = FURNITURE_CATALOG.desk_wood;
      const placed: PlacedFurnitureItem[] = [
        { id: 'desk_1', defId: 'desk_wood', gx: 2, gy: 2, rotation: 0 },
      ];

      // Placing chair on tile (2, 2) which is already occupied
      const chair = FURNITURE_CATALOG.chair_teal;
      const res = canPlaceFurniture(2, 2, chair, 0, roomGrid, placed, blockedWallsMask);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('furniture_overlap');

      // Placing another desk overlapping tile (3, 2)
      const resDesk = canPlaceFurniture(3, 2, desk, 0, roomGrid, placed, blockedWallsMask);
      expect(resDesk.valid).toBe(false);
      expect(resDesk.reason).toBe('furniture_overlap');
    });

    it('allows placement when ignoring own item id (for moving items)', () => {
      const desk = FURNITURE_CATALOG.desk_wood;
      const placed: PlacedFurnitureItem[] = [
        { id: 'desk_1', defId: 'desk_wood', gx: 2, gy: 2, rotation: 0 },
      ];

      // Re-validating position of desk_1 itself
      const res = canPlaceFurniture(2, 2, desk, 0, roomGrid, placed, blockedWallsMask, 'desk_1');
      expect(res.valid).toBe(true);
    });
  });

  describe('updateWalkabilityMask & findPlacedFurnitureAt', () => {
    it('updates walkability grid: blocks tiles when item placed and frees them when removed', () => {
      const placed: PlacedFurnitureItem[] = [
        { id: 'desk_1', defId: 'desk_wood', gx: 3, gy: 3, rotation: 0 }, // occupies (3,3) and (4,3)
      ];

      // 1. With desk placed
      const maskWith = updateWalkabilityMask(roomGrid, blockedWallsMask, placed);
      expect(maskWith[3][3]).toBe(true); // blocked
      expect(maskWith[3][4]).toBe(true); // blocked
      expect(maskWith[4][4]).toBe(false); // open

      // 2. Remove desk
      const maskEmpty = updateWalkabilityMask(roomGrid, blockedWallsMask, []);
      expect(maskEmpty[3][3]).toBe(false); // freed!
      expect(maskEmpty[3][4]).toBe(false); // freed!
    });

    it('finds placed furniture at coordinates accurately', () => {
      const placed: PlacedFurnitureItem[] = [
        { id: 'desk_1', defId: 'desk_wood', gx: 3, gy: 3, rotation: 0 },
        { id: 'ficus_1', defId: 'ficus', gx: 6, gy: 6, rotation: 0 },
      ];

      expect(findPlacedFurnitureAt(3, 3, placed)?.id).toBe('desk_1');
      expect(findPlacedFurnitureAt(4, 3, placed)?.id).toBe('desk_1');
      expect(findPlacedFurnitureAt(6, 6, placed)?.id).toBe('ficus_1');
      expect(findPlacedFurnitureAt(5, 5, placed)).toBeNull();
    });
  });
});
