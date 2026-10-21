import { CampusGrid, TileCoord, TileType } from './gridTypes';
import { getTileKey, parseTileKey } from './gridMath';

export const WALKABLE_TILE_TYPES: ReadonlySet<TileType> = new Set([
  'floor',
  'corridor',
  'door_n',
  'door_w',
]);

/**
 * Checks whether a given TileType is walkable.
 */
export function isWalkable(type: TileType | undefined): boolean {
  if (!type) return false;
  return WALKABLE_TILE_TYPES.has(type);
}

/**
 * Checks whether a grid coordinate is within bounds and walkable.
 */
export function isTileWalkable(grid: CampusGrid, coord: TileCoord): boolean {
  if (
    coord.x < 0 ||
    coord.x >= grid.width ||
    coord.y < 0 ||
    coord.y >= grid.height
  ) {
    return false;
  }
  const key = getTileKey(coord.x, coord.y);
  const tile = grid.tiles[key];
  if (!tile) return false;
  return isWalkable(tile.type);
}

/**
 * Manhattan distance heuristic.
 */
function manhattanDistance(a: TileCoord, b: TileCoord): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * A* Pathfinding implementation for CampusGrid.
 * Finds the shortest walkable path between start and goal.
 * Returns array of coordinates [start, ..., goal], or null if no path exists.
 */
export function findPath(
  grid: CampusGrid,
  start: TileCoord,
  goal: TileCoord
): TileCoord[] | null {
  if (!isTileWalkable(grid, start) || !isTileWalkable(grid, goal)) {
    return null;
  }

  const startKey = getTileKey(start.x, start.y);
  const goalKey = getTileKey(goal.x, goal.y);

  if (startKey === goalKey) {
    return [start];
  }

  // Open set with priority queue behavior
  const openSet = new Set<string>([startKey]);
  const cameFrom = new Map<string, string>();

  const gScore = new Map<string, number>();
  gScore.set(startKey, 0);

  const fScore = new Map<string, number>();
  fScore.set(startKey, manhattanDistance(start, goal));

  const directions = [
    { x: 0, y: -1 }, // N
    { x: 1, y: 0 },  // E
    { x: 0, y: 1 },  // S
    { x: -1, y: 0 }, // W
  ];

  while (openSet.size > 0) {
    // Find node in openSet with lowest fScore
    let currentKey: string | null = null;
    let lowestF = Infinity;

    for (const key of openSet) {
      const score = fScore.get(key) ?? Infinity;
      if (score < lowestF) {
        lowestF = score;
        currentKey = key;
      }
    }

    if (!currentKey) break;

    if (currentKey === goalKey) {
      // Reconstruct path
      const path: TileCoord[] = [goal];
      let curr = currentKey;
      while (cameFrom.has(curr)) {
        curr = cameFrom.get(curr)!;
        path.push(parseTileKey(curr));
      }
      path.reverse();
      return path;
    }

    openSet.delete(currentKey);
    const currentCoord = parseTileKey(currentKey);
    const currentG = gScore.get(currentKey) ?? Infinity;

    for (const dir of directions) {
      const neighbor: TileCoord = {
        x: currentCoord.x + dir.x,
        y: currentCoord.y + dir.y,
      };

      if (!isTileWalkable(grid, neighbor)) {
        continue;
      }

      const neighborKey = getTileKey(neighbor.x, neighbor.y);
      const tentativeG = currentG + 1;
      const neighborG = gScore.get(neighborKey) ?? Infinity;

      if (tentativeG < neighborG) {
        cameFrom.set(neighborKey, currentKey);
        gScore.set(neighborKey, tentativeG);
        fScore.set(neighborKey, tentativeG + manhattanDistance(neighbor, goal));

        if (!openSet.has(neighborKey)) {
          openSet.add(neighborKey);
        }
      }
    }
  }

  return null;
}

import { gridToIso } from './gridMath';

/**
 * Converts an array of TileCoords into an isometric SVG path 'M x,y L x,y ...'
 */
export function pathToSvgD(path: TileCoord[] | null, tileW = 64, tileH = 32): string {
  if (!path || path.length === 0) return '';
  return path
    .map((coord, idx) => {
      const { isoX, isoY } = gridToIso(coord.x, coord.y, tileW, tileH);
      return `${idx === 0 ? 'M' : 'L'} ${isoX.toFixed(1)},${isoY.toFixed(1)}`;
    })
    .join(' ');
}

