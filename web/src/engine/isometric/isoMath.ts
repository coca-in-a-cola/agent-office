/**
 * 2:1 Dimetric Isometric Mathematics for Agent Office Tycoon.
 * Standard tile dimensions: tileW = 64, tileH = 32.
 */

export interface ScreenPoint {
  screenX: number;
  screenY: number;
}

export interface GridPoint {
  gx: number;
  gy: number;
}

export interface IsoMathOptions {
  originX?: number;
  originY?: number;
  tileW?: number;
  tileH?: number;
}

const DEFAULT_TILE_W = 64;
const DEFAULT_TILE_H = 32;

export function isoToScreen(
  gx: number,
  gy: number,
  options?: IsoMathOptions
): ScreenPoint {
  const originX = options?.originX ?? 0;
  const originY = options?.originY ?? 0;
  const tileW = options?.tileW ?? DEFAULT_TILE_W;
  const tileH = options?.tileH ?? DEFAULT_TILE_H;

  const halfW = tileW / 2;
  const halfH = tileH / 2;

  return {
    screenX: originX + (gx - gy) * halfW,
    screenY: originY + (gx + gy) * halfH,
  };
}

export function screenToIso(
  screenX: number,
  screenY: number,
  options?: IsoMathOptions
): GridPoint {
  const originX = options?.originX ?? 0;
  const originY = options?.originY ?? 0;
  const tileW = options?.tileW ?? DEFAULT_TILE_W;
  const tileH = options?.tileH ?? DEFAULT_TILE_H;

  const halfW = tileW / 2;
  const halfH = tileH / 2;

  const dx = screenX - originX;
  const dy = screenY - originY;

  return {
    gx: 0.5 * (dx / halfW + dy / halfH),
    gy: 0.5 * (dy / halfH - dx / halfW),
  };
}

export function snapToGrid(
  screenX: number,
  screenY: number,
  options?: IsoMathOptions
): GridPoint {
  const { gx, gy } = screenToIso(screenX, screenY, options);
  return {
    gx: Math.round(gx),
    gy: Math.round(gy),
  };
}

export function isPointInDiamond(
  px: number,
  py: number,
  tileCenterScreenX: number,
  tileCenterScreenY: number,
  tileW = DEFAULT_TILE_W,
  tileH = DEFAULT_TILE_H
): boolean {
  const halfW = tileW / 2;
  const halfH = tileH / 2;
  const dx = Math.abs(px - tileCenterScreenX);
  const dy = Math.abs(py - tileCenterScreenY);

  // Normalised diamond equation: (dx / halfW) + (dy / halfH) <= 1
  return (dx / halfW) + (dy / halfH) <= 1 + 1e-7;
}

export function calculateDepthZ(
  gx: number,
  gy: number,
  heightLayer = 0
): number {
  return Math.round((gx + gy) * 100) + heightLayer;
}
