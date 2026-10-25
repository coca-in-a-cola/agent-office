/**
 * Campus Grid Persistence Client API for Agent Office.
 * Handles fetching and saving CampusGridV2 layouts with placed furniture,
 * plus legacy CampusGrid (tiles+rooms) used by IsometricOffice.
 */

import type { PlacedFurnitureItem } from '../grid/footprintEngine';
import type { CampusGrid } from '../grid/gridTypes';
import { transport } from './transport';

export interface CampusGridV2 {
  schemaVersion: 2;
  width: number;
  height: number;
  tiles?: Record<string, any>;
  rooms?: Record<string, any>;
  furniture: PlacedFurnitureItem[];
}

interface GridFetchResponse {
  status: string;
  grid: CampusGridV2;
}

interface GridSaveResponse {
  status: string;
  saved: boolean;
}

// ---------------------------------------------------------------------------
// V2 (footprint-engine schema) — used by the new editor
// ---------------------------------------------------------------------------

export async function fetchCampusGrid(): Promise<CampusGridV2 | null> {
  try {
    const data = await transport<GridFetchResponse>('/api/office/grid');
    if (data?.status === 'ok' && data.grid && typeof data.grid === 'object') {
      return data.grid as CampusGridV2;
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveCampusGrid(grid: CampusGridV2): Promise<boolean> {
  try {
    const data = await transport<GridSaveResponse>('/api/office/grid', {
      method: 'POST',
      body: { grid },
    });
    return Boolean(data?.status === 'ok' && data.saved);
  } catch {
    return false;
  }
}

/**
 * Fetch the V2 campus grid with TanStack Query cancellation support.
 *
 * Unlike fetchCampusGrid(), this variant:
 *  - Accepts an AbortSignal so TanStack Query can cancel in-flight requests.
 *  - Returns null for empty/missing grid data (queryFn must return null, not throw).
 *  - Propagates transport errors as thrown exceptions so TanStack sets isError.
 *    (Transport 4xx/5xx → HttpError is rethrown; only absent-grid → null.)
 */
export async function fetchCampusGridV2(
  signal?: AbortSignal,
): Promise<CampusGridV2 | null> {
  const data = await transport<GridFetchResponse>('/api/office/grid', { signal });
  if (data?.status === 'ok' && data.grid && typeof data.grid === 'object') {
    return data.grid as CampusGridV2;
  }
  return null;
}

/**
 * Persist the V2 campus grid and surface save failures as thrown errors.
 *
 * Unlike saveCampusGrid(), this variant throws instead of returning false so
 * TanStack Query mutations surface failures via isError / error rather than
 * silently succeeding. Callers must not cache a successful result when this
 * throws.
 */
export async function saveCampusGridV2(grid: CampusGridV2): Promise<void> {
  const data = await transport<GridSaveResponse>('/api/office/grid', {
    method: 'POST',
    body: { grid },
  });
  if (!(data?.status === 'ok' && data.saved)) {
    throw new Error(
      `Grid save acknowledged but server did not confirm: status=${data?.status} saved=${data?.saved}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Legacy (CampusGrid — tiles+rooms schema) — used by IsometricOffice
// ---------------------------------------------------------------------------

/** TanStack Query key factory for the legacy campus grid. */
export function campusGridKey(): readonly ['campusGrid'] {
  return ['campusGrid'] as const;
}

interface LegacyGridFetchResponse {
  status: string;
  grid: CampusGrid;
}

interface LegacyGridSaveResponse {
  status: string;
}

/**
 * Fetch the legacy CampusGrid (tiles+rooms) via the universal transport.
 * Returns null when the response is absent, malformed, or has no tiles.
 * Accepts an optional AbortSignal for TanStack Query cancellation.
 */
export async function fetchCampusGridLegacy(
  signal?: AbortSignal,
): Promise<CampusGrid | null> {
  try {
    const data = await transport<LegacyGridFetchResponse>('/api/office/grid', {
      signal,
    });
    if (
      data?.status === 'ok' &&
      data.grid &&
      data.grid.tiles &&
      Object.keys(data.grid.tiles).length > 0
    ) {
      return data.grid;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Persist the legacy CampusGrid (tiles+rooms) via the universal transport.
 * Returns true on acknowledged save.
 * Accepts an optional AbortSignal for TanStack Query cancellation.
 */
export async function saveCampusGridLegacy(
  grid: CampusGrid,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const data = await transport<LegacyGridSaveResponse>('/api/office/grid', {
      method: 'POST',
      body: { grid },
      signal,
    });
    return data?.status === 'ok';
  } catch {
    return false;
  }
}
