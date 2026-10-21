import { describe, expect, it } from 'bun:test';
import {
  CHARACTER_DIRECTIONS,
  CHARACTER_HEAD_TYPES,
  CHARACTER_POSES,
} from './characterTypes';
import {
  CORE_CHARACTER_SKINS,
  DEFAULT_CHARACTER_SKIN,
  getAgentSkin,
} from './characterSkins';

describe('AO-CHAR-01: Character Rig & Skin System', () => {
  const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

  describe('Core Agent Skins', () => {
    const EXPECTED_AGENT_IDS = ['tyler', 'coder', 'artist', 'devops', 'qa', 'webdev'] as const;

    it('defines all 6 core agent skins with valid attributes', () => {
      for (const agentId of EXPECTED_AGENT_IDS) {
        const skin = CORE_CHARACTER_SKINS[agentId];
        expect(skin).toBeDefined();
        expect(skin.id).toBe(agentId);
        expect(skin.profileName).toBeTruthy();
        expect(typeof skin.profileName).toBe('string');
        expect(CHARACTER_HEAD_TYPES).toContain(skin.headType);
      }
    });

    it('verifies all 6 core agent skins have valid hex colors', () => {
      for (const agentId of EXPECTED_AGENT_IDS) {
        const skin = CORE_CHARACTER_SKINS[agentId];
        expect(skin.primaryColor).toMatch(HEX_COLOR_REGEX);
        expect(skin.accentColor).toMatch(HEX_COLOR_REGEX);
        expect(skin.jointColor).toMatch(HEX_COLOR_REGEX);
      }
    });

    it('verifies default character skin fallback has valid hex colors and structure', () => {
      expect(DEFAULT_CHARACTER_SKIN.id).toBe('standard');
      expect(DEFAULT_CHARACTER_SKIN.headType).toBe('standard');
      expect(DEFAULT_CHARACTER_SKIN.primaryColor).toMatch(HEX_COLOR_REGEX);
      expect(DEFAULT_CHARACTER_SKIN.accentColor).toMatch(HEX_COLOR_REGEX);
      expect(DEFAULT_CHARACTER_SKIN.jointColor).toMatch(HEX_COLOR_REGEX);
    });
  });

  describe('getAgentSkin Resolution and Fallbacks', () => {
    it('returns the exact skin for known agent IDs', () => {
      const knownIds = ['tyler', 'coder', 'artist', 'devops', 'qa', 'webdev'];
      for (const id of knownIds) {
        const skin = getAgentSkin(id);
        expect(skin).toEqual(CORE_CHARACTER_SKINS[id]);
      }
    });

    it('handles case-insensitive and whitespace-padded agent IDs', () => {
      expect(getAgentSkin(' TYLER ')).toEqual(CORE_CHARACTER_SKINS.tyler);
      expect(getAgentSkin('Coder')).toEqual(CORE_CHARACTER_SKINS.coder);
      expect(getAgentSkin('DEVOPS')).toEqual(CORE_CHARACTER_SKINS.devops);
    });

    it('resolves skin by role when agentId is unknown or custom', () => {
      const roleMappings = [
        { role: 'swe', expectedSkinKey: 'coder' },
        { role: 'developer', expectedSkinKey: 'coder' },
        { role: 'designer', expectedSkinKey: 'artist' },
        { role: 'infra', expectedSkinKey: 'devops' },
        { role: 'tester', expectedSkinKey: 'qa' },
        { role: 'frontend', expectedSkinKey: 'webdev' },
        { role: 'ceo', expectedSkinKey: 'tyler' },
      ];

      for (const { role, expectedSkinKey } of roleMappings) {
        const customId = `custom-${role}`;
        const skin = getAgentSkin(customId, role);
        const expected = CORE_CHARACTER_SKINS[expectedSkinKey];

        expect(skin.primaryColor).toBe(expected.primaryColor);
        expect(skin.accentColor).toBe(expected.accentColor);
        expect(skin.jointColor).toBe(expected.jointColor);
        expect(skin.headType).toBe(expected.headType);
        expect(skin.id).toBe(customId);
      }
    });

    it('returns appropriate fallback for completely unknown IDs / custom roles', () => {
      const fallback = getAgentSkin('unregistered-bot', 'marketing');
      expect(fallback.id).toBe('unregistered-bot');
      expect(fallback.profileName).toBe('Unregistered-bot');
      expect(fallback.primaryColor).toBe(DEFAULT_CHARACTER_SKIN.primaryColor);
      expect(fallback.accentColor).toBe(DEFAULT_CHARACTER_SKIN.accentColor);
      expect(fallback.jointColor).toBe(DEFAULT_CHARACTER_SKIN.jointColor);
      expect(fallback.headType).toBe('standard');
    });

    it('returns default skin when called with empty strings', () => {
      const skin = getAgentSkin('');
      expect(skin.id).toBe(DEFAULT_CHARACTER_SKIN.id);
      expect(skin.profileName).toBe(DEFAULT_CHARACTER_SKIN.profileName);
      expect(skin.headType).toBe(DEFAULT_CHARACTER_SKIN.headType);
    });
  });

  describe('Pose Constants', () => {
    it('contains all required character poses', () => {
      const expectedPoses = ['seated_work', 'seated_sleep', 'seated_idle', 'walking'] as const;
      for (const pose of expectedPoses) {
        expect(CHARACTER_POSES).toContain(pose);
      }
      expect(CHARACTER_POSES.length).toBe(4);
    });
  });

  describe('Direction Constants', () => {
    it('contains all required character directions', () => {
      const expectedDirections = ['left', 'right', 'down_iso', 'up_iso'] as const;
      for (const dir of expectedDirections) {
        expect(CHARACTER_DIRECTIONS).toContain(dir);
      }
      expect(CHARACTER_DIRECTIONS.length).toBe(4);
    });
  });
});
