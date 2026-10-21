import { TileCoord } from './gridTypes';

/**
 * Projects 2D grid coordinates to 2.5D isometric screen coordinates.
 */
export function gridToIso(
  x: number,
  y: number,
  tileW = 64,
  tileH = 32
): { isoX: number; isoY: number } {
  const isoX = (x - y) * (tileW / 2);
  const isoY = (x + y) * (tileH / 2);
  return { isoX, isoY };
}

/**
 * Inverts isometric screen coordinates back to 2D grid coordinates.
 */
export function isoToGrid(
  isoX: number,
  isoY: number,
  tileW = 64,
  tileH = 32
): TileCoord {
  const halfW = tileW / 2;
  const halfH = tileH / 2;
  const x = (isoX / halfW + isoY / halfH) / 2;
  const y = (isoY / halfH - isoX / halfW) / 2;
  return {
    x: Math.round(x),
    y: Math.round(y),
  };
}

/**
 * Computes hash key for a tile coordinate.
 */
export function getTileKey(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * Parses a tile hash key back to coordinate object.
 */
export function parseTileKey(key: string): TileCoord {
  const [x, y] = key.split(',').map(Number);
  return { x, y };
}

/**
 * Returns the 4 isometric diamond points for SVG polygon: top, right, bottom, left.
 */
export function getIsometricPolygonPoints(
  x: number,
  y: number,
  tileW = 64,
  tileH = 32
): string {
  const { isoX, isoY } = gridToIso(x, y, tileW, tileH);
  const halfW = tileW / 2;
  const halfH = tileH / 2;

  const top = `${isoX},${isoY - halfH}`;
  const right = `${isoX + halfW},${isoY}`;
  const bottom = `${isoX},${isoY + halfH}`;
  const left = `${isoX - halfW},${isoY}`;

  return `${top} ${right} ${bottom} ${left}`;
}
