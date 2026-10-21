import { describe, expect, it } from 'bun:test';
import {
  gridToIso,
  isoToGrid,
  getTileKey,
  parseTileKey,
  getIsometricPolygonPoints,
} from './gridMath';
import {
  generateDefaultCampus,
  assignDefaultRoomForAgent,
  CORE_SUITES,
} from './campusGenerator';
import { findPath, isTileWalkable, isWalkable } from './pathfinding';

describe('AO-GRID-01: Isometric Grid Math', () => {
  it('performs round-trip conversion between grid and isometric screen coordinates', () => {
    const testCases = [
      { x: 0, y: 0 },
      { x: 5, y: 10 },
      { x: 12, y: 7 },
      { x: -4, y: 8 },
      { x: 25, y: 25 },
    ];

    for (const { x, y } of testCases) {
      const { isoX, isoY } = gridToIso(x, y);
      const converted = isoToGrid(isoX, isoY);
      expect(converted.x).toBe(x);
      expect(converted.y).toBe(y);
    }
  });

  it('correctly hashes and parses tile keys', () => {
    expect(getTileKey(14, 28)).toBe('14,28');
    const parsed = parseTileKey('14,28');
    expect(parsed.x).toBe(14);
    expect(parsed.y).toBe(28);
  });

  it('generates 4 isometric diamond points for SVG rendering', () => {
    const pointsStr = getIsometricPolygonPoints(2, 3, 64, 32);
    const points = pointsStr.split(' ');
    expect(points.length).toBe(4);

    // Each point should be formatted as "x,y"
    for (const pt of points) {
      const [px, py] = pt.split(',').map(Number);
      expect(Number.isFinite(px)).toBe(true);
      expect(Number.isFinite(py)).toBe(true);
    }
  });
});

describe('AO-GRID-01: Campus Grid Generator', () => {
  it('generates default campus with all 6 core suites registered', () => {
    const campus = generateDefaultCampus();

    expect(campus.width).toBeGreaterThanOrEqual(24);
    expect(campus.height).toBeGreaterThanOrEqual(24);

    const expectedSuites = ['tyler', 'coder', 'artist', 'devops', 'qa', 'webdev'];
    for (const suiteId of expectedSuites) {
      const room = campus.rooms[suiteId];
      expect(room).toBeDefined();
      expect(room.id).toBe(suiteId);
      expect(room.ownerAgentId).toBe(suiteId);
      expect(room.tiles.length).toBeGreaterThan(0);

      // Verify desk coordinate is walkable floor
      const deskTile = campus.tiles[getTileKey(room.deskCoord.x, room.deskCoord.y)];
      expect(deskTile).toBeDefined();
      expect(deskTile.type).toBe('floor');
      expect(deskTile.roomId).toBe(suiteId);

      // Verify door coordinate is a valid door type
      const doorTile = campus.tiles[getTileKey(room.doorCoord.x, room.doorCoord.y)];
      expect(doorTile).toBeDefined();
      expect(['door_n', 'door_w']).toContain(doorTile.type);
      expect(doorTile.roomId).toBe(suiteId);
    }
  });

  it('assignDefaultRoomForAgent creates a room attached to an agent and connects to corridors', () => {
    const campus = generateDefaultCampus();
    const newAgentId = 'agent-growth';
    const updated = assignDefaultRoomForAgent(
      campus,
      newAgentId,
      'Growth Hacker',
      'Growth Lab'
    );

    const newRoom = updated.rooms[newAgentId];
    expect(newRoom).toBeDefined();
    expect(newRoom.ownerAgentId).toBe(newAgentId);
    expect(newRoom.name).toBe('Growth Lab');
    expect(newRoom.tiles.length).toBeGreaterThan(0);

    // Verify desk and door tiles exist
    const deskTile = updated.tiles[getTileKey(newRoom.deskCoord.x, newRoom.deskCoord.y)];
    expect(deskTile).toBeDefined();
    expect(deskTile.type).toBe('floor');

    const doorTile = updated.tiles[getTileKey(newRoom.doorCoord.x, newRoom.doorCoord.y)];
    expect(doorTile).toBeDefined();
    expect(['door_n', 'door_w']).toContain(doorTile.type);

    // Verify pathfinding from new agent desk to Tyler's executive desk
    const path = findPath(updated, newRoom.deskCoord, updated.rooms['tyler'].deskCoord);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(0);
    expect(path![0]).toEqual(newRoom.deskCoord);
    expect(path![path!.length - 1]).toEqual(updated.rooms['tyler'].deskCoord);
  });
});

describe('AO-GRID-01: A* Pathfinding', () => {
  it('correctly reports walkable and non-walkable tile types', () => {
    expect(isWalkable('floor')).toBe(true);
    expect(isWalkable('corridor')).toBe(true);
    expect(isWalkable('door_n')).toBe(true);
    expect(isWalkable('door_w')).toBe(true);

    expect(isWalkable('empty')).toBe(false);
    expect(isWalkable('wall_n')).toBe(false);
    expect(isWalkable('wall_w')).toBe(false);
    expect(isWalkable('corner_nw')).toBe(false);
    expect(isWalkable(undefined)).toBe(false);
  });

  it('navigates from Coder desk to QA desk through corridors and doors', () => {
    const campus = generateDefaultCampus();
    const coderDesk = campus.rooms['coder'].deskCoord;
    const qaDesk = campus.rooms['qa'].deskCoord;

    const path = findPath(campus, coderDesk, qaDesk);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(1);

    // Start and end match
    expect(path![0]).toEqual(coderDesk);
    expect(path![path!.length - 1]).toEqual(qaDesk);

    // Every intermediate step is adjacent and strictly walkable
    for (let i = 0; i < path!.length; i++) {
      const step = path![i];
      expect(isTileWalkable(campus, step)).toBe(true);

      if (i > 0) {
        const prev = path![i - 1];
        const stepDist = Math.abs(step.x - prev.x) + Math.abs(step.y - prev.y);
        expect(stepDist).toBe(1);
      }
    }

    // Verify path passes through doors and corridors
    const tileTypes = path!.map(coord => campus.tiles[getTileKey(coord.x, coord.y)].type);
    expect(tileTypes).toContain('corridor');
    expect(tileTypes.some(t => t === 'door_n' || t === 'door_w')).toBe(true);
  });

  it('allows reciprocal navigation between all 6 core suite desks', () => {
    const campus = generateDefaultCampus();
    const suiteKeys = CORE_SUITES.map(s => s.id);

    for (const fromId of suiteKeys) {
      for (const toId of suiteKeys) {
        if (fromId === toId) continue;
        const start = campus.rooms[fromId].deskCoord;
        const goal = campus.rooms[toId].deskCoord;

        const path = findPath(campus, start, goal);
        expect(path).not.toBeNull();
        expect(path![0]).toEqual(start);
        expect(path![path!.length - 1]).toEqual(goal);
      }
    }
  });

  it('returns [start] when start coordinate equals goal coordinate', () => {
    const campus = generateDefaultCampus();
    const desk = campus.rooms['coder'].deskCoord;
    const path = findPath(campus, desk, desk);
    expect(path).toEqual([desk]);
  });

  it('returns null when start or goal is blocked', () => {
    const campus = generateDefaultCampus();
    const coderDesk = campus.rooms['coder'].deskCoord;
    const blockedWall = { x: 2, y: 4 }; // corner_nw of coder room

    expect(findPath(campus, coderDesk, blockedWall)).toBeNull();
    expect(findPath(campus, blockedWall, coderDesk)).toBeNull();

    // Out of bounds
    expect(findPath(campus, coderDesk, { x: 999, y: 999 })).toBeNull();
  });
});
