import type { TileCoord } from './gridTypes';

export type FurnitureRotation = 0 | 90 | 180 | 270;

export type FurnitureCategory = 'desk' | 'seating' | 'decor' | 'amenity';

export interface FurnitureDefinition {
  id: string;
  name: string;
  width: number;
  height: number;
  category: FurnitureCategory;
  textureKey?: string;
  icon?: string;
}

export interface PlacedFurnitureItem {
  id: string;
  defId: string;
  gx: number;
  gy: number;
  rotation: FurnitureRotation;
  customName?: string;
}

export interface RoomGridDimensions {
  width: number;
  height: number;
}

export interface PlacementValidationResult {
  valid: boolean;
  reason?: 'out_of_bounds' | 'wall_collision' | 'furniture_overlap' | string;
  occupiedTiles: TileCoord[];
}

export const FURNITURE_CATALOG: Record<string, FurnitureDefinition> = {
  desk_wood: {
    id: 'desk_wood',
    name: 'Desk',
    width: 2,
    height: 1,
    category: 'desk',
    textureKey: 'desk_wood',
  },
  chair_teal: {
    id: 'chair_teal',
    name: 'Chair',
    width: 1,
    height: 1,
    category: 'seating',
    textureKey: 'chair_teal',
  },
  ficus: {
    id: 'ficus',
    name: 'Ficus',
    width: 1,
    height: 1,
    category: 'decor',
    textureKey: 'ficus',
  },
  cooler: {
    id: 'cooler',
    name: 'Cooler',
    width: 1,
    height: 1,
    category: 'amenity',
    textureKey: 'cooler',
  },
  whiteboard: {
    id: 'whiteboard',
    name: 'Whiteboard',
    width: 2,
    height: 1,
    category: 'decor',
    textureKey: 'whiteboard',
  },
};

/**
 * Calculates occupied grid tiles for a furniture item given its top-left anchor and rotation.
 * 0° and 180°: span is baseWidth x baseHeight.
 * 90° and 270°: span is baseHeight x baseWidth.
 */
export function getFootprintTiles(
  gx: number,
  gy: number,
  itemDef: FurnitureDefinition,
  rotation: FurnitureRotation
): TileCoord[] {
  const isOrthogonal = rotation === 0 || rotation === 180;
  const spanX = isOrthogonal ? itemDef.width : itemDef.height;
  const spanY = isOrthogonal ? itemDef.height : itemDef.width;

  const tiles: TileCoord[] = [];
  for (let dy = 0; dy < spanY; dy++) {
    for (let dx = 0; dx < spanX; dx++) {
      tiles.push({ x: gx + dx, y: gy + dy });
    }
  }
  return tiles;
}

/**
 * Validates whether a furniture piece can be placed at the target grid coordinates.
 * Checks bounds, wall collisions (blockedMask), and overlap with other placed items.
 */
export function canPlaceFurniture(
  gx: number,
  gy: number,
  itemDef: FurnitureDefinition,
  rotation: FurnitureRotation,
  roomGrid: RoomGridDimensions,
  placedItems: PlacedFurnitureItem[],
  blockedMask?: boolean[][] | null,
  ignoreItemId?: string
): PlacementValidationResult {
  const occupiedTiles = getFootprintTiles(gx, gy, itemDef, rotation);

  // 1. Boundary check: all tiles within [0..width-1, 0..height-1]
  for (const tile of occupiedTiles) {
    if (tile.x < 0 || tile.x >= roomGrid.width || tile.y < 0 || tile.y >= roomGrid.height) {
      return {
        valid: false,
        reason: 'out_of_bounds',
        occupiedTiles,
      };
    }
  }

  // 2. Wall / blocked mask check
  if (blockedMask) {
    for (const tile of occupiedTiles) {
      if (blockedMask[tile.y]?.[tile.x] === true) {
        return {
          valid: false,
          reason: 'wall_collision',
          occupiedTiles,
        };
      }
    }
  }

  // 3. Furniture collision: cannot overlap existing placed items
  for (const existing of placedItems) {
    if (ignoreItemId && existing.id === ignoreItemId) {
      continue;
    }
    const def = FURNITURE_CATALOG[existing.defId];
    if (!def) continue;

    const existingTiles = getFootprintTiles(existing.gx, existing.gy, def, existing.rotation);
    for (const occ of occupiedTiles) {
      for (const ex of existingTiles) {
        if (occ.x === ex.x && occ.y === ex.y) {
          return {
            valid: false,
            reason: 'furniture_overlap',
            occupiedTiles,
          };
        }
      }
    }
  }

  return {
    valid: true,
    occupiedTiles,
  };
}

/**
 * Computes a 2D boolean walkability grid (true = blocked, false = walkable).
 * When furniture is added, its tiles are marked blocked.
 * When furniture is removed, its tiles immediately become walkable again.
 */
export function updateWalkabilityMask(
  roomGrid: RoomGridDimensions,
  wallsMask?: boolean[][] | null,
  placedItems: PlacedFurnitureItem[] = []
): boolean[][] {
  const mask: boolean[][] = Array.from({ length: roomGrid.height }, (_, y) =>
    Array.from({ length: roomGrid.width }, (_, x) => {
      if (wallsMask && wallsMask[y] && wallsMask[y][x]) {
        return true;
      }
      return false;
    })
  );

  for (const item of placedItems) {
    const def = FURNITURE_CATALOG[item.defId];
    if (!def) continue;

    const tiles = getFootprintTiles(item.gx, item.gy, def, item.rotation);
    for (const tile of tiles) {
      if (tile.y >= 0 && tile.y < roomGrid.height && tile.x >= 0 && tile.x < roomGrid.width) {
        mask[tile.y][tile.x] = true;
      }
    }
  }

  return mask;
}

/**
 * Finds which placed item covers the specified grid coordinate (x, y), if any.
 */
export function findPlacedFurnitureAt(
  gx: number,
  gy: number,
  placedItems: PlacedFurnitureItem[]
): PlacedFurnitureItem | null {
  for (const item of placedItems) {
    const def = FURNITURE_CATALOG[item.defId];
    if (!def) continue;

    const tiles = getFootprintTiles(item.gx, item.gy, def, item.rotation);
    if (tiles.some((t) => t.x === gx && t.y === gy)) {
      return item;
    }
  }
  return null;
}

/**
 * Rotates rotation by 90 degrees clockwise (0 -> 90 -> 180 -> 270 -> 0).
 */
export function getNextRotation(current: FurnitureRotation): FurnitureRotation {
  switch (current) {
    case 0:
      return 90;
    case 90:
      return 180;
    case 180:
      return 270;
    case 270:
      return 0;
  }
}
