export type CharacterPose = 'seated_work' | 'seated_idle' | 'seated_sleep' | 'walking';

export type CharacterDirection = 'left' | 'right' | 'down_iso' | 'up_iso';

export type CharacterHeadType =
  | 'crown'
  | 'crt'
  | 'lens'
  | 'server'
  | 'scanner'
  | 'dome'
  | 'standard';

export interface CharacterSkinFeatures {
  crown?: boolean;
  monocle?: boolean;
  crtGlyphs?: string;
  dualExhaust?: boolean;
  loupe?: boolean;
  antennaOrb?: boolean;
  [key: string]: unknown;
}

export interface CharacterSkin {
  id: string;
  profileName: string;
  primaryColor: string;
  accentColor: string;
  jointColor: string;
  headType: CharacterHeadType;
  features?: CharacterSkinFeatures;
}

export const CHARACTER_POSES: readonly CharacterPose[] = [
  'seated_work',
  'seated_idle',
  'seated_sleep',
  'walking',
] as const;

export const CHARACTER_DIRECTIONS: readonly CharacterDirection[] = [
  'left',
  'right',
  'down_iso',
  'up_iso',
] as const;

export const CHARACTER_HEAD_TYPES: readonly CharacterHeadType[] = [
  'crown',
  'crt',
  'lens',
  'server',
  'scanner',
  'dome',
  'standard',
] as const;

export interface ModularCharacterProps {
  skin: CharacterSkin;
  pose?: CharacterPose;
  direction?: CharacterDirection;
  isSelected?: boolean;
  scale?: number;
  className?: string;
  onClick?: () => void;
}
