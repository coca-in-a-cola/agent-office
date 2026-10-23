import { describe, it, expect, afterEach } from 'bun:test';
import { fetchCampusGrid, saveCampusGrid, type CampusGridV2 } from './gridPersistence';

describe('gridPersistence client API', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetchCampusGrid parses valid CampusGridV2 payload', async () => {
    const sampleV2: CampusGridV2 = {
      schemaVersion: 2,
      width: 8,
      height: 8,
      furniture: [
        { id: 'furn_1', defId: 'desk_wood', gx: 2, gy: 2, rotation: 0 },
      ],
    };

    globalThis.fetch = (async (url: string) => {
      if (url === '/api/office/grid') {
        return {
          ok: true,
          json: async () => ({ status: 'ok', grid: sampleV2 }),
        } as Response;
      }
      return { ok: false } as Response;
    }) as any;

    const grid = await fetchCampusGrid();
    expect(grid).not.toBeNull();
    expect(grid?.schemaVersion).toBe(2);
    expect(grid?.furniture).toHaveLength(1);
    expect(grid?.furniture[0].defId).toBe('desk_wood');
  });

  it('fetchCampusGrid returns null on network failure or 404', async () => {
    globalThis.fetch = (async () => {
      return { ok: false, status: 404 } as Response;
    }) as any;

    const grid = await fetchCampusGrid();
    expect(grid).toBeNull();
  });

  it('saveCampusGrid sends POST and returns true on success', async () => {
    let capturedBody: any = null;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (url === '/api/office/grid' && init?.method === 'POST') {
        capturedBody = JSON.parse(init.body as string);
        return {
          ok: true,
          json: async () => ({ status: 'ok', saved: true }),
        } as Response;
      }
      return { ok: false } as Response;
    }) as any;

    const v2: CampusGridV2 = {
      schemaVersion: 2,
      width: 8,
      height: 8,
      furniture: [{ id: 'furn_2', defId: 'chair_teal', gx: 1, gy: 1, rotation: 90 }],
    };

    const success = await saveCampusGrid(v2);
    expect(success).toBe(true);
    expect(capturedBody).toEqual({ grid: v2 });
  });
});
