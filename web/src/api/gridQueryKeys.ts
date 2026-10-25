/**
 * Stable TanStack Query key factories for campus grid V2 (furniture editor).
 *
 * Keys are under the 'campusGridV2' namespace — distinct from the legacy
 * 'campusGrid' key used by IsometricOffice so the two caches never collide
 * even though both hit the same /api/office/grid endpoint.
 */

export const gridV2Keys = {
  /** Root scope — pass to invalidateQueries for a full grid V2 cache wipe. */
  all: ['campusGridV2'] as const,

  /** The canonical V2 grid record (furniture + schemaVersion 2). */
  grid: () => ['campusGridV2', 'grid'] as const,
} as const;
