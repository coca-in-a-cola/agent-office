import { CharacterSkin } from './characterTypes';

export const CORE_CHARACTER_SKINS: Record<string, CharacterSkin> = {
  tyler: {
    id: 'tyler',
    profileName: 'Tyler',
    primaryColor: '#451a03',
    accentColor: '#f59e0b',
    jointColor: '#d97706',
    headType: 'crown',
    features: {
      crown: true,
      monocle: true,
      antennaOrb: true,
    },
  },
  coder: {
    id: 'coder',
    profileName: 'Coder',
    primaryColor: '#0f172a',
    accentColor: '#10b981',
    jointColor: '#059669',
    headType: 'crt',
    features: {
      crtGlyphs: '>_ 101',
      antennaOrb: true,
    },
  },
  artist: {
    id: 'artist',
    profileName: 'Artist',
    primaryColor: '#1e293b',
    accentColor: '#ec4899',
    jointColor: '#db2777',
    headType: 'lens',
    features: {
      loupe: true,
    },
  },
  devops: {
    id: 'devops',
    profileName: 'DevOps',
    primaryColor: '#0f172a',
    accentColor: '#3b82f6',
    jointColor: '#2563eb',
    headType: 'server',
    features: {
      dualExhaust: true,
    },
  },
  qa: {
    id: 'qa',
    profileName: 'QA',
    primaryColor: '#083344',
    accentColor: '#06b6d4',
    jointColor: '#0891b2',
    headType: 'scanner',
    features: {
      loupe: true,
    },
  },
  webdev: {
    id: 'webdev',
    profileName: 'WebDev',
    primaryColor: '#082f49',
    accentColor: '#0ea5e9',
    jointColor: '#0284c7',
    headType: 'dome',
    features: {
      antennaOrb: true,
    },
  },
};

export const DEFAULT_CHARACTER_SKIN: CharacterSkin = {
  id: 'standard',
  profileName: 'Agent',
  primaryColor: '#1e293b',
  accentColor: '#94a3b8',
  jointColor: '#475569',
  headType: 'standard',
  features: {},
};

const ROLE_TO_SKIN_KEY: Record<string, string> = {
  executive: 'tyler',
  founder: 'tyler',
  ceo: 'tyler',
  tyler: 'tyler',
  code: 'coder',
  coder: 'coder',
  dev: 'coder',
  developer: 'coder',
  swe: 'coder',
  art: 'artist',
  artist: 'artist',
  design: 'artist',
  designer: 'artist',
  ops: 'devops',
  devops: 'devops',
  infra: 'devops',
  sysadmin: 'devops',
  qa: 'qa',
  test: 'qa',
  tester: 'qa',
  quality: 'qa',
  web: 'webdev',
  webdev: 'webdev',
  frontend: 'webdev',
};

/**
 * Returns the character skin configuration for an agent ID or role,
 * with fallbacks for custom hires and unknown IDs.
 */
export function getAgentSkin(agentId: string, role?: string): CharacterSkin {
  const normId = (agentId || '').trim().toLowerCase();

  if (normId && CORE_CHARACTER_SKINS[normId]) {
    return CORE_CHARACTER_SKINS[normId];
  }

  if (role) {
    const normRole = role.trim().toLowerCase();
    const mappedKey = ROLE_TO_SKIN_KEY[normRole];
    if (mappedKey && CORE_CHARACTER_SKINS[mappedKey]) {
      return {
        ...CORE_CHARACTER_SKINS[mappedKey],
        id: normId || mappedKey,
      };
    }
  }

  // Fallback for custom hires
  const displayName = agentId
    ? agentId.charAt(0).toUpperCase() + agentId.slice(1)
    : DEFAULT_CHARACTER_SKIN.profileName;

  return {
    ...DEFAULT_CHARACTER_SKIN,
    id: normId || DEFAULT_CHARACTER_SKIN.id,
    profileName: displayName,
  };
}
