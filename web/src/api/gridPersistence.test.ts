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
        return Response.json({ status: 'ok', grid: sampleV2 });
      }
      return new Response('', { status: 404 });
    }) as any;

    const grid = await fetchCampusGrid();
    expect(grid).not.toBeNull();
    expect(grid?.schemaVersion).toBe(2);
    expect(grid?.furniture).toHaveLength(1);
    expect(grid?.furniture[0].defId).toBe('desk_wood');
  });

  it('fetchCampusGrid returns null on network failure or 404', async () => {
    globalThis.fetch = (async () => {
      return new Response('', { status: 404 });
    }) as any;

    const grid = await fetchCampusGrid();
    expect(grid).toBeNull();
  });

  it('fetchCampusGrid returns null on throw', async () => {
    globalThis.fetch = (async () => {
      throw new Error('Network error');
    }) as any;

    const grid = await fetchCampusGrid();
    expect(grid).toBeNull();
  });

  it('saveCampusGrid sends POST and returns true on success', async () => {
    let capturedBody: any = null;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (url === '/api/office/grid' && init?.method === 'POST') {
        capturedBody = JSON.parse(init.body as string);
        return Response.json({ status: 'ok', saved: true });
      }
      return new Response('', { status: 404 });
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

  it('saveCampusGrid returns false on HTTP error', async () => {
    globalThis.fetch = (async () => {
      return Response.json({ message: 'Server error' }, { status: 500 });
    }) as any;

    const v2: CampusGridV2 = { schemaVersion: 2, width: 4, height: 4, furniture: [] };
    const success = await saveCampusGrid(v2);
    expect(success).toBe(false);
  });

  it('saveCampusGrid returns false on network throw', async () => {
    globalThis.fetch = (async () => {
      throw new Error('Network error');
    }) as any;

    const v2: CampusGridV2 = { schemaVersion: 2, width: 4, height: 4, furniture: [] };
    const success = await saveCampusGrid(v2);
    expect(success).toBe(false);
  });
});
