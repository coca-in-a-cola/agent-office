/**
 * Unified 8x8 Shared Office Room Scene for Agent Office Tycoon.
 * Houses all 6 active agents (Tyler, Coder, WebDev, Artist, DevOps, QA),
 * zoned flooring (sage carpet & warm wood break area), cutaway walls, and depth sorting.
 */

import { Container, Sprite, AnimatedSprite, type Spritesheet } from 'pixi.js';
import { isoToScreen, calculateDepthZ, isPointInDiamond } from '../engine/isometric/isoMath';

export interface FloorTileInfo {
  gx: number;
  gy: number;
  zone: 'carpet' | 'parquet';
  screenX: number;
  screenY: number;
  zIndex: number;
  tint: number;
}

export interface WorkstationInfo {
  agentId: string;
  agentName: string;
  role: string;
  deskGX: number;
  deskGY: number;
  deskScreenX: number;
  deskScreenY: number;
  chairGX: number;
  chairGY: number;
  chairScreenX: number;
  chairScreenY: number;
  agentGX: number;
  agentGY: number;
  agentScreenX: number;
  agentScreenY: number;
  status: 'idle' | 'working';
  zIndexDesktop: number;
  zIndexAgent: number;
  zIndexApron: number;
}

export interface DecorItemInfo {
  id: string;
  name: string;
  type: 'ficus' | 'cooler' | 'board';
  gx: number;
  gy: number;
  screenX: number;
  screenY: number;
  zIndex: number;
}

export interface WallSegment {
  wallId: string;
  screenX: number;
  screenY: number;
  zIndex: number;
  anchor: { x: number; y: number };
}

export interface OfficeRoomLayout {
  gridWidth: number;
  gridHeight: number;
  originX: number;
  originY: number;
  floorTiles: FloorTileInfo[];
  walls: WallSegment[];
  workstations: WorkstationInfo[];
  decor: DecorItemInfo[];
}

export const AGENT_CONFIGS = [
  { id: 'tyler', name: 'Tyler', role: 'Managing Director', deskGX: 2.0, deskGY: 1.8 },
  { id: 'coder', name: 'Coder', role: 'Game Developer', deskGX: 5.5, deskGY: 1.8 },
  { id: 'webdev', name: 'WebDev', role: 'Web Engineer', deskGX: 2.0, deskGY: 4.8 },
  { id: 'artist', name: 'Artist', role: '2D/3D Artist', deskGX: 5.5, deskGY: 4.8 },
  { id: 'devops', name: 'DevOps', role: 'DevOps', deskGX: 2.0, deskGY: 7.2 },
  { id: 'qa', name: 'QA', role: 'Quality Assurance', deskGX: 5.5, deskGY: 7.2 },
];

export function createOfficeRoomLayout(
  gridWidth = 8,
  gridHeight = 8,
  originX = 0,
  originY = 0
): OfficeRoomLayout {
  const floorTiles: FloorTileInfo[] = [];

  for (let gy = 0; gy < gridHeight; gy++) {
    for (let gx = 0; gx < gridWidth; gx++) {
      const { screenX, screenY } = isoToScreen(gx, gy, { originX, originY });
      // Breakout coffee / lounge zone in the far east corner
      const isBreakout = (gx >= 6 && gy >= 6);
      const zone: 'carpet' | 'parquet' = isBreakout ? 'parquet' : 'carpet';
      const tint = isBreakout ? 0xd4a373 : 0xffffff; // Warm wood tint vs natural sage

      floorTiles.push({
        gx,
        gy,
        zone,
        screenX,
        screenY,
        zIndex: calculateDepthZ(gx, gy, 0),
        tint,
      });
    }
  }

  // Cutaway walls along perimeter
  const walls: WallSegment[] = [];
  // North-west corner apex wall
  const apexScreen = isoToScreen(0, 0, { originX, originY });
  walls.push({
    wallId: 'wall_cutaway_north',
    screenX: apexScreen.screenX,
    screenY: apexScreen.screenY - 16,
    zIndex: 10,
    anchor: { x: 112 / 224, y: 88 / 160 },
  });

  // Workstations for all 6 agents
  const workstations: WorkstationInfo[] = AGENT_CONFIGS.map((agent) => {
    const chairGX = agent.deskGX - 0.7;
    const chairGY = agent.deskGY - 0.3;
    const agentGX = agent.deskGX - 0.7;
    const agentGY = agent.deskGY - 0.3;

    const deskScreen = isoToScreen(agent.deskGX, agent.deskGY, { originX, originY });
    const chairScreen = isoToScreen(chairGX, chairGY, { originX, originY });
    const agentScreen = isoToScreen(agentGX, agentGY, { originX, originY });

    return {
      agentId: agent.id,
      agentName: agent.name,
      role: agent.role,
      deskGX: agent.deskGX,
      deskGY: agent.deskGY,
      deskScreenX: deskScreen.screenX,
      deskScreenY: deskScreen.screenY,
      chairGX,
      chairGY,
      chairScreenX: chairScreen.screenX,
      chairScreenY: chairScreen.screenY,
      agentGX,
      agentGY,
      agentScreenX: agentScreen.screenX,
      agentScreenY: agentScreen.screenY,
      status: 'idle',
      zIndexDesktop: calculateDepthZ(agent.deskGX, agent.deskGY, 40),
      zIndexAgent: calculateDepthZ(agent.deskGX, agent.deskGY, 50),
      zIndexApron: calculateDepthZ(agent.deskGX, agent.deskGY, 60),
    };
  });

  // Decor props
  const decor: DecorItemInfo[] = [
    {
      id: 'ficus_east',
      name: 'Ficus Lounge',
      type: 'ficus',
      gx: 7.2,
      gy: 7.2,
      screenX: isoToScreen(7.2, 7.2, { originX, originY }).screenX,
      screenY: isoToScreen(7.2, 7.2, { originX, originY }).screenY,
      zIndex: calculateDepthZ(7.2, 7.2, 30),
    },
    {
      id: 'ficus_west',
      name: 'Ficus Entrance',
      type: 'ficus',
      gx: 0.5,
      gy: 3.5,
      screenX: isoToScreen(0.5, 3.5, { originX, originY }).screenX,
      screenY: isoToScreen(0.5, 3.5, { originX, originY }).screenY,
      zIndex: calculateDepthZ(0.5, 3.5, 30),
    },
  ];

  return {
    gridWidth,
    gridHeight,
    originX,
    originY,
    floorTiles,
    walls,
    workstations,
    decor,
  };
}

export function getOccupiedTileMask(layout: OfficeRoomLayout): boolean[][] {
  const mask: boolean[][] = Array.from({ length: layout.gridHeight }, () =>
    Array(layout.gridWidth).fill(false)
  );

  // Mark perimeter walls (outer boundary edges) as blocked
  for (let x = 0; x < layout.gridWidth; x++) {
    mask[0][x] = true;
  }
  for (let y = 0; y < layout.gridHeight; y++) {
    mask[y][0] = true;
  }

  // Mark workstation desks as blocked (approx 2x1 tiles)
  for (const ws of layout.workstations) {
    const minX = Math.max(0, Math.floor(ws.deskGX - 0.5));
    const maxX = Math.min(layout.gridWidth - 1, Math.ceil(ws.deskGX));
    const minY = Math.max(0, Math.floor(ws.deskGY - 0.5));
    const maxY = Math.min(layout.gridHeight - 1, Math.ceil(ws.deskGY));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        mask[y][x] = true;
      }
    }
  }

  return mask;
}

export function hitTestSceneItem(
  screenX: number,
  screenY: number,
  layout: OfficeRoomLayout
): { type: 'agent' | 'desk' | 'decor' | 'floor' | 'none'; id?: string } {
  // Check workstations in reverse z-order (front to back)
  const sortedWorkstations = [...layout.workstations].sort((a, b) => b.zIndexApron - a.zIndexApron);

  for (const ws of sortedWorkstations) {
    if (isPointInDiamond(screenX, screenY, ws.deskScreenX, ws.deskScreenY, 80, 48)) {
      return { type: 'agent', id: ws.agentId };
    }
  }

  // Check decor
  for (const item of layout.decor) {
    if (isPointInDiamond(screenX, screenY, item.screenX, item.screenY, 48, 32)) {
      return { type: 'decor', id: item.id };
    }
  }

  // Check floor tiles
  for (const tile of layout.floorTiles) {
    if (isPointInDiamond(screenX, screenY, tile.screenX, tile.screenY, 64, 32)) {
      return { type: 'floor', id: `${tile.gx}_${tile.gy}` };
    }
  }

  return { type: 'none' };
}

export function buildPixiRoomScene(
  spritesheet: Spritesheet,
  layout: OfficeRoomLayout,
  onSelectAgent?: (agentId: string) => void
): {
  rootContainer: Container;
  setAgentStatus: (agentId: string, status: 'idle' | 'working') => void;
} {
  const rootContainer = new Container();
  rootContainer.sortableChildren = true;

  const agentAnimators = new Map<string, (mode: 'idle' | 'typing') => void>();

  // 1. Floor Tiles
  for (const tile of layout.floorTiles) {
    const floorSprite = new Sprite(spritesheet.textures['floor_sage']);
    floorSprite.anchor.set(0.5, 0.5);
    floorSprite.position.set(tile.screenX, tile.screenY);
    floorSprite.zIndex = tile.zIndex;
    if (tile.tint !== 0xffffff) {
      floorSprite.tint = tile.tint;
    }
    rootContainer.addChild(floorSprite);
  }

  // 2. Perimeter Walls
  for (const wall of layout.walls) {
    const wallSprite = new Sprite(spritesheet.textures['wall_cutaway']);
    wallSprite.anchor.set(wall.anchor.x, wall.anchor.y);
    wallSprite.position.set(wall.screenX, wall.screenY);
    wallSprite.zIndex = wall.zIndex;
    rootContainer.addChild(wallSprite);
  }

  // 3. Decor Props
  for (const decor of layout.decor) {
    if (decor.type === 'ficus') {
      const ficusSprite = new Sprite(spritesheet.textures['ficus']);
      ficusSprite.anchor.set(56 / 112, 141 / 160);
      ficusSprite.position.set(decor.screenX, decor.screenY);
      ficusSprite.zIndex = decor.zIndex;
      rootContainer.addChild(ficusSprite);
    }
  }

  // 4. Workstations for each agent
  for (const ws of layout.workstations) {
    // Chair
    const chairSprite = new Sprite(spritesheet.textures['chair_teal']);
    chairSprite.anchor.set(56 / 112, 104 / 128);
    chairSprite.position.set(ws.chairScreenX, ws.chairScreenY);
    chairSprite.zIndex = calculateDepthZ(ws.deskGX, ws.deskGY, 20);
    rootContainer.addChild(chairSprite);

    // Agent Avatar (Animated)
    const agentContainer = new Container();
    agentContainer.position.set(ws.agentScreenX, ws.agentScreenY);
    agentContainer.zIndex = ws.zIndexAgent;

    const idleTexture = spritesheet.textures['miro_idle'];
    const typingTextures = [
      spritesheet.textures['miro_typing_01'],
      spritesheet.textures['miro_typing_02'],
    ];

    const idleSprite = new Sprite(idleTexture);
    idleSprite.anchor.set(40 / 80, 103 / 112);
    idleSprite.visible = true;

    const typingSprite = new AnimatedSprite(typingTextures);
    typingSprite.anchor.set(40 / 80, 103 / 112);
    typingSprite.animationSpeed = 6 / 60; // 6 FPS
    typingSprite.play();
    typingSprite.visible = false;

    agentContainer.addChild(idleSprite);
    agentContainer.addChild(typingSprite);
    rootContainer.addChild(agentContainer);

    // Desktop
    const deskSprite = new Sprite(spritesheet.textures['desk_wood']);
    deskSprite.anchor.set(80 / 160, 118 / 144);
    deskSprite.position.set(ws.deskScreenX, ws.deskScreenY);
    deskSprite.zIndex = ws.zIndexDesktop;
    deskSprite.eventMode = 'static';
    deskSprite.cursor = 'pointer';
    deskSprite.on('pointerdown', () => onSelectAgent?.(ws.agentId));
    rootContainer.addChild(deskSprite);

    // Front Apron (natural overlap over chair/legs)
    if (spritesheet.textures['desk_front']) {
      const apronSprite = new Sprite(spritesheet.textures['desk_front']);
      apronSprite.anchor.set(80 / 160, 118 / 144);
      apronSprite.position.set(ws.deskScreenX, ws.deskScreenY);
      apronSprite.zIndex = ws.zIndexApron;
      rootContainer.addChild(apronSprite);
    }

    agentAnimators.set(ws.agentId, (mode) => {
      if (mode === 'typing') {
        idleSprite.visible = false;
        typingSprite.visible = true;
      } else {
        typingSprite.visible = false;
        idleSprite.visible = true;
      }
    });
  }

  const setAgentStatus = (agentId: string, status: 'idle' | 'working') => {
    const animator = agentAnimators.get(agentId);
    if (animator) {
      animator(status === 'working' ? 'typing' : 'idle');
    }
  };

  return { rootContainer, setAgentStatus };
}
