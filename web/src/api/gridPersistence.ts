/**
 * Campus Grid Persistence Client API for Agent Office.
 * Handles fetching and saving CampusGridV2 layouts with placed furniture.
 */

import type { PlacedFurnitureItem } from '../grid/footprintEngine';

export interface CampusGridV2 {
  schemaVersion: 2;
  width: number;
  height: number;
  tiles?: Record<string, any>;
  rooms?: Record<string, any>;
  furniture: PlacedFurnitureItem[];
}

export async function fetchCampusGrid(): Promise<CampusGridV2 | null> {
  try {
    const res = await fetch('/api/office/grid');
    if (!res.ok) return null;
    const data = await res.json();
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
    const res = await fetch('/api/office/grid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grid }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data?.status === 'ok' && data.saved);
  } catch {
    return false;
  }
}
