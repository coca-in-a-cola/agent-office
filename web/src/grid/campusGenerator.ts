import { CampusGrid, RoomDefinition, TileCoord, TileData, TileType } from './gridTypes';
import { getTileKey } from './gridMath';

export const DEFAULT_CAMPUS_WIDTH = 28;
export const DEFAULT_CAMPUS_HEIGHT = 28;

interface SuiteConfig {
  id: string;
  name: string;
  ownerAgentId: string;
  color: string;
  floorTheme: string;
  wallTheme: string;
  origin: TileCoord;
  width: number;
  height: number;
  deskOffset: TileCoord;
  doorOffset: TileCoord;
  doorType: 'door_n' | 'door_w';
}

/**
 * Metadata for the 6 core suites.
 */
export const CORE_SUITES: SuiteConfig[] = [
  {
    id: 'tyler',
    name: 'Executive Suite',
    ownerAgentId: 'tyler',
    color: '#f59e0b',
    floorTheme: 'mahogany',
    wallTheme: 'executive',
    origin: { x: 11, y: 4 },
    width: 6,
    height: 4,
    deskOffset: { x: 2, y: 2 },
    doorOffset: { x: 2, y: 0 },
    doorType: 'door_n',
  },
  {
    id: 'coder',
    name: 'Dev Den',
    ownerAgentId: 'coder',
    color: '#10b981',
    floorTheme: 'dev-grid',
    wallTheme: 'dark-slate',
    origin: { x: 2, y: 4 },
    width: 5,
    height: 4,
    deskOffset: { x: 2, y: 2 },
    doorOffset: { x: 2, y: 0 },
    doorType: 'door_n',
  },
  {
    id: 'artist',
    name: 'Creative Bay',
    ownerAgentId: 'artist',
    color: '#ec4899',
    floorTheme: 'creative-bay',
    wallTheme: 'creative-pink',
    origin: { x: 20, y: 4 },
    width: 5,
    height: 4,
    deskOffset: { x: 2, y: 2 },
    doorOffset: { x: 2, y: 0 },
    doorType: 'door_n',
  },
  {
    id: 'devops',
    name: 'Server NOC',
    ownerAgentId: 'devops',
    color: '#3b82f6',
    floorTheme: 'server-noc',
    wallTheme: 'server-metal',
    origin: { x: 2, y: 14 },
    width: 5,
    height: 4,
    deskOffset: { x: 2, y: 2 },
    doorOffset: { x: 0, y: 2 },
    doorType: 'door_w',
  },
  {
    id: 'qa',
    name: 'Testing Lab',
    ownerAgentId: 'qa',
    color: '#06b6d4',
    floorTheme: 'qa-cleanroom',
    wallTheme: 'cleanroom',
    origin: { x: 20, y: 14 },
    width: 5,
    height: 4,
    deskOffset: { x: 2, y: 2 },
    doorOffset: { x: 0, y: 2 },
    doorType: 'door_w',
  },
  {
    id: 'webdev',
    name: 'Staging Deck',
    ownerAgentId: 'webdev',
    color: '#0ea5e9',
    floorTheme: 'staging-deck',
    wallTheme: 'staging-blue',
    origin: { x: 11, y: 14 },
    width: 6,
    height: 4,
    deskOffset: { x: 2, y: 2 },
    doorOffset: { x: 2, y: 0 },
    doorType: 'door_n',
  },
];

/**
 * Builds tiles for a room and writes them into grid tiles.
 */
function buildRoomTiles(
  tiles: Record<string, TileData>,
  config: {
    id: string;
    floorTheme: string;
    origin: TileCoord;
    width: number;
    height: number;
    doorOffset: TileCoord;
    doorType: 'door_n' | 'door_w';
  }
): { roomTiles: TileCoord[]; doorCoord: TileCoord } {
  const roomTiles: TileCoord[] = [];
  const { origin, width, height, doorOffset, doorType, id, floorTheme } = config;
  const doorCoord: TileCoord = {
    x: origin.x + doorOffset.x,
    y: origin.y + doorOffset.y,
  };

  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      const x = origin.x + dx;
      const y = origin.y + dy;
      const coord: TileCoord = { x, y };
      roomTiles.push(coord);

      let type: TileType = 'floor';

      if (dx === 0 && dy === 0) {
        type = 'corner_nw';
      } else if (dy === 0) {
        if (x === doorCoord.x && y === doorCoord.y) {
          type = doorType;
        } else {
          type = 'wall_n';
        }
      } else if (dx === 0) {
        if (x === doorCoord.x && y === doorCoord.y) {
          type = doorType;
        } else {
          type = 'wall_w';
        }
      } else {
        type = 'floor';
      }

      tiles[getTileKey(x, y)] = {
        x,
        y,
        type,
        roomId: id,
        floorTheme,
      };
    }
  }

  return { roomTiles, doorCoord };
}

/**
 * Sets a corridor tile at (x, y) if within bounds and not a wall/door.
 */
function placeCorridorTile(tiles: Record<string, TileData>, x: number, y: number): void {
  const key = getTileKey(x, y);
  const existing = tiles[key];
  if (!existing || existing.type === 'empty') {
    tiles[key] = {
      x,
      y,
      type: 'corridor',
    };
  }
}

/**
 * Generates the default corporate campus grid with 6 core suites and an interconnected corridor spine.
 */
export function generateDefaultCampus(): CampusGrid {
  const width = DEFAULT_CAMPUS_WIDTH;
  const height = DEFAULT_CAMPUS_HEIGHT;
  const tiles: Record<string, TileData> = {};
  const rooms: Record<string, RoomDefinition> = {};

  // 1. Initialize empty grid
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      tiles[getTileKey(x, y)] = {
        x,
        y,
        type: 'empty',
      };
    }
  }

  // 2. Build 6 Core Suites
  for (const suite of CORE_SUITES) {
    const { roomTiles, doorCoord } = buildRoomTiles(tiles, {
      id: suite.id,
      floorTheme: suite.floorTheme,
      origin: suite.origin,
      width: suite.width,
      height: suite.height,
      doorOffset: suite.doorOffset,
      doorType: suite.doorType,
    });

    const deskCoord: TileCoord = {
      x: suite.origin.x + suite.deskOffset.x,
      y: suite.origin.y + suite.deskOffset.y,
    };

    rooms[suite.id] = {
      id: suite.id,
      name: suite.name,
      ownerAgentId: suite.ownerAgentId,
      color: suite.color,
      floorTheme: suite.floorTheme,
      wallTheme: suite.wallTheme,
      tiles: roomTiles,
      deskCoord,
      doorCoord,
    };
  }

  // 3. Build Interconnected Corridor Spine
  // Upper corridor: y = 3 from x = 4 to x = 22 (connects Coder, Tyler, Artist doors)
  for (let x = 4; x <= 22; x++) {
    placeCorridorTile(tiles, x, 3);
  }

  // Central vertical spine: x = 13 from y = 3 down to y = 18
  for (let y = 3; y <= 18; y++) {
    placeCorridorTile(tiles, 13, y);
  }

  // Central crossway: y = 10 from x = 1 to x = 26
  for (let x = 1; x <= 26; x++) {
    placeCorridorTile(tiles, x, 10);
  }

  // West branch: x = 1 from y = 10 to y = 18 (connects to DevOps door at (2, 16))
  for (let y = 10; y <= 18; y++) {
    placeCorridorTile(tiles, 1, y);
  }

  // East branch: x = 19 from y = 10 to y = 18 (connects to QA door at (20, 16))
  for (let y = 10; y <= 18; y++) {
    placeCorridorTile(tiles, 19, y);
  }

  return {
    width,
    height,
    tiles,
    rooms,
  };
}

/**
 * Automatically creates and binds a new room for a newly created employee,
 * connecting its door to the nearest corridor.
 */
export function assignDefaultRoomForAgent(
  grid: CampusGrid,
  agentId: string,
  role: string,
  roomName?: string
): CampusGrid {
  const roomW = 5;
  const roomH = 4;

  // Clone grid immutably
  const width = grid.width;
  let height = grid.height;
  const tiles: Record<string, TileData> = { ...grid.tiles };
  const rooms: Record<string, RoomDefinition> = { ...grid.rooms };

  // Find a free bounding box for the new room
  let placedOrigin: TileCoord | null = null;

  for (let candidateY = 19; candidateY <= height - roomH - 1; candidateY += 5) {
    for (let candidateX = 2; candidateX <= width - roomW - 1; candidateX += 6) {
      // Check if all tiles in candidate area are empty
      let canPlace = true;
      for (let dy = 0; dy < roomH; dy++) {
        for (let dx = 0; dx < roomW; dx++) {
          const key = getTileKey(candidateX + dx, candidateY + dy);
          const t = tiles[key];
          if (!t || t.type !== 'empty') {
            canPlace = false;
            break;
          }
        }
        if (!canPlace) break;
      }

      if (canPlace) {
        placedOrigin = { x: candidateX, y: candidateY };
        break;
      }
    }
    if (placedOrigin) break;
  }

  // If no space in current grid, expand grid height
  if (!placedOrigin) {
    const oldHeight = height;
    height = oldHeight + 8;
    for (let y = oldHeight; y < height; y++) {
      for (let x = 0; x < width; x++) {
        tiles[getTileKey(x, y)] = { x, y, type: 'empty' };
      }
    }
    placedOrigin = { x: 2, y: oldHeight + 1 };
  }

  const roomId = agentId;
  const displayName = roomName || `${role || 'Agent'} Suite`;
  const floorTheme = 'staging-deck';
  const wallTheme = 'standard';
  const color = '#6366f1';

  const { roomTiles, doorCoord } = buildRoomTiles(tiles, {
    id: roomId,
    floorTheme,
    origin: placedOrigin,
    width: roomW,
    height: roomH,
    doorOffset: { x: 2, y: 0 },
    doorType: 'door_n',
  });

  const deskCoord: TileCoord = {
    x: placedOrigin.x + 2,
    y: placedOrigin.y + 2,
  };

  rooms[roomId] = {
    id: roomId,
    name: displayName,
    ownerAgentId: agentId,
    color,
    floorTheme,
    wallTheme,
    tiles: roomTiles,
    deskCoord,
    doorCoord,
  };

  // Connect door to the nearest corridor
  // The tile directly outside door_n is (doorCoord.x, doorCoord.y - 1)
  const outsideCoord: TileCoord = {
    x: doorCoord.x,
    y: doorCoord.y - 1,
  };
  placeCorridorTile(tiles, outsideCoord.x, outsideCoord.y);

  // Find nearest existing corridor tile (excluding outsideCoord)
  let nearestCorridor: TileCoord | null = null;
  let minDistance = Infinity;

  for (const t of Object.values(tiles)) {
    if (
      t.type === 'corridor' &&
      !(t.x === outsideCoord.x && t.y === outsideCoord.y)
    ) {
      const dist =
        Math.abs(t.x - outsideCoord.x) + Math.abs(t.y - outsideCoord.y);
      if (dist < minDistance) {
        minDistance = dist;
        nearestCorridor = { x: t.x, y: t.y };
      }
    }
  }

  if (nearestCorridor) {
    // Carve corridor from outsideCoord to nearestCorridor
    let currX = outsideCoord.x;
    let currY = outsideCoord.y;

    // Step in Y direction
    const stepY = nearestCorridor.y > currY ? 1 : -1;
    while (currY !== nearestCorridor.y) {
      currY += stepY;
      placeCorridorTile(tiles, currX, currY);
    }

    // Step in X direction
    const stepX = nearestCorridor.x > currX ? 1 : -1;
    while (currX !== nearestCorridor.x) {
      currX += stepX;
      placeCorridorTile(tiles, currX, currY);
    }
  }

  return {
    width,
    height,
    tiles,
    rooms,
  };
}
