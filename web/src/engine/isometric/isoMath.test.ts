import { describe, expect, it } from 'bun:test';
import {
  calculateDepthZ,
  isPointInDiamond,
  isoToScreen,
  screenToIso,
  snapToGrid,
} from './isoMath';

describe('isoMath', () => {
  describe('round-trip accuracy', () => {
    it('accurately converts grid coordinates to screen coordinates and back for integers', () => {
      const testCoordinates = [
        { gx: 0, gy: 0 },
        { gx: 5, gy: 3 },
        { gx: -4, gy: 7 },
        { gx: 10, gy: -12 },
        { gx: 100, gy: 100 },
      ];

      for (const { gx, gy } of testCoordinates) {
        const screen = isoToScreen(gx, gy);
        const iso = screenToIso(screen.screenX, screen.screenY);
        expect(iso.gx).toBeCloseTo(gx, 6);
        expect(iso.gy).toBeCloseTo(gy, 6);
      }
    });

    it('accurately converts grid coordinates to screen coordinates and back for fractional values', () => {
      const fractionalCoordinates = [
        { gx: 0.25, gy: 0.75 },
        { gx: 1.5, gy: 2.25 },
        { gx: -3.333, gy: 8.667 },
        { gx: 12.125, gy: 4.875 },
      ];

      for (const { gx, gy } of fractionalCoordinates) {
        const screen = isoToScreen(gx, gy);
        const iso = screenToIso(screen.screenX, screen.screenY);
        expect(iso.gx).toBeCloseTo(gx, 6);
        expect(iso.gy).toBeCloseTo(gy, 6);
      }
    });

    it('supports custom origin and tile dimensions', () => {
      const opts = { originX: 400, originY: 300, tileW: 128, tileH: 64 };
      const gx = 4.5;
      const gy = 2.5;

      const screen = isoToScreen(gx, gy, opts);
      const iso = screenToIso(screen.screenX, screen.screenY, opts);
      expect(iso.gx).toBeCloseTo(gx, 6);
      expect(iso.gy).toBeCloseTo(gy, 6);
    });
  });

  describe('snapToGrid', () => {
    it('snaps screen coordinates near the center to the exact tile coordinate', () => {
      const screenCenter = isoToScreen(3, 4);
      const snapped = snapToGrid(screenCenter.screenX, screenCenter.screenY);
      expect(snapped.gx).toBe(3);
      expect(snapped.gy).toBe(4);
    });

    it('snaps screen coordinates slightly offset within quadrant to correct integer grid', () => {
      const screenCenter = isoToScreen(3, 4);
      // Small offset within tile diamond (center dx=5, dy=2 with tileW=64, tileH=32)
      const offsetPoint = {
        screenX: screenCenter.screenX + 5,
        screenY: screenCenter.screenY + 2,
      };
      const snapped = snapToGrid(offsetPoint.screenX, offsetPoint.screenY);
      expect(snapped.gx).toBe(3);
      expect(snapped.gy).toBe(4);
    });

    it('snaps coordinates near neighbor boundary to the adjacent grid tile', () => {
      // (3, 4) screen pos vs (4, 4) screen pos
      const screen34 = isoToScreen(3, 4);
      const screen44 = isoToScreen(4, 4);
      // Midway biased towards (4, 4)
      const midBiased = {
        screenX: screen34.screenX * 0.2 + screen44.screenX * 0.8,
        screenY: screen34.screenY * 0.2 + screen44.screenY * 0.8,
      };
      const snapped = snapToGrid(midBiased.screenX, midBiased.screenY);
      expect(snapped.gx).toBe(4);
      expect(snapped.gy).toBe(4);
    });
  });

  describe('isPointInDiamond', () => {
    const tileW = 64;
    const tileH = 32;
    const halfW = tileW / 2; // 32
    const halfH = tileH / 2; // 16
    const centerX = 200;
    const centerY = 150;

    it('returns true for center point', () => {
      expect(isPointInDiamond(centerX, centerY, centerX, centerY, tileW, tileH)).toBe(true);
    });

    it('returns true for all boundary diamond vertices (top, bottom, left, right)', () => {
      const topVertex = { px: centerX, py: centerY - halfH };
      const bottomVertex = { px: centerX, py: centerY + halfH };
      const leftVertex = { px: centerX - halfW, py: centerY };
      const rightVertex = { px: centerX + halfW, py: centerY };

      expect(isPointInDiamond(topVertex.px, topVertex.py, centerX, centerY, tileW, tileH)).toBe(true);
      expect(isPointInDiamond(bottomVertex.px, bottomVertex.py, centerX, centerY, tileW, tileH)).toBe(true);
      expect(isPointInDiamond(leftVertex.px, leftVertex.py, centerX, centerY, tileW, tileH)).toBe(true);
      expect(isPointInDiamond(rightVertex.px, rightVertex.py, centerX, centerY, tileW, tileH)).toBe(true);
    });

    it('returns false for points clearly outside the diamond', () => {
      // Outside bounding box corners
      expect(isPointInDiamond(centerX - halfW, centerY - halfH, centerX, centerY, tileW, tileH)).toBe(false);
      expect(isPointInDiamond(centerX + halfW, centerY - halfH, centerX, centerY, tileW, tileH)).toBe(false);
      expect(isPointInDiamond(centerX - halfW, centerY + halfH, centerX, centerY, tileW, tileH)).toBe(false);
      expect(isPointInDiamond(centerX + halfW, centerY + halfH, centerX, centerY, tileW, tileH)).toBe(false);

      // Points further away
      expect(isPointInDiamond(centerX, centerY - halfH - 1, centerX, centerY, tileW, tileH)).toBe(false);
      expect(isPointInDiamond(centerX + halfW + 1, centerY, centerX, centerY, tileW, tileH)).toBe(false);
    });
  });

  describe('calculateDepthZ', () => {
    it('character in front of desk (gx=1, gy=2) has higher Z than desk (gx=1, gy=1)', () => {
      const deskZ = calculateDepthZ(1, 1);
      const characterZ = calculateDepthZ(1, 2);
      expect(characterZ).toBeGreaterThan(deskZ);
      expect(characterZ - deskZ).toBe(100);
    });

    it('heightLayer offsets Z correctly on same grid coordinate', () => {
      const groundZ = calculateDepthZ(2, 3, 0);
      const tabletopZ = calculateDepthZ(2, 3, 5);
      const ceilingZ = calculateDepthZ(2, 3, 10);

      expect(tabletopZ).toBe(groundZ + 5);
      expect(ceilingZ).toBe(groundZ + 10);
    });
  });
});
