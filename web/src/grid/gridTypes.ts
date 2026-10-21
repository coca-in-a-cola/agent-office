export interface TileCoord {
  x: number;
  y: number;
}

export type TileType =
  | 'empty'
  | 'floor'
  | 'wall_n'
  | 'wall_w'
  | 'corner_nw'
  | 'door_n'
  | 'door_w'
  | 'corridor';

export interface TileData {
  x: number;
  y: number;
  type: TileType;
  roomId?: string;
  floorTheme?: string;
  propId?: string;
}

export interface RoomDefinition {
  id: string;
  name: string;
  ownerAgentId: string;
  color: string;
  floorTheme: string;
  wallTheme: string;
  tiles: TileCoord[];
  deskCoord: TileCoord;
  doorCoord: TileCoord;
}

export interface CampusGrid {
  width: number;
  height: number;
  tiles: Record<string, TileData>;
  rooms: Record<string, RoomDefinition>;
}
