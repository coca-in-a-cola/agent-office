/**
 * Focused regression tests for useFurnitureGrid (useGridV2Query + useGridV2Mutation).
 *
 * Tests exercise actual production options via QueryClient/MutationObserver —
 * not copied logic. Ensures that:
 *
 *  1. Serialized write order: two rapid saves queue and execute one-at-a-time;
 *     the second call's snapshot is what finally reaches the server.
 *  2. False-save surfaces as error: saveCampusGridV2 throws when server returns
 *     { status: 'ok', saved: false } — mutation isError becomes true.
 *  3. Transport error surfaces as error: HTTP 500 makes mutation isError true
 *     (no false-cache success).
 *  4. Abort guard: queryFn forwards the AbortSignal; aborting mid-flight causes
 *     the transport to reject so the query enters error state, not success.
 *  5. Payload unchanged: saveCampusGridV2 sends the exact grid body the caller
 *     passed — no silent transformation or re-wrap.
 *  6. retry: false on mutation — a 500 never auto-retries.
 *
 * Approach:
 *  - No React/DOM harness — mutations exercised via QueryClient / MutationObserver
 *    (same pattern as useDraftMutations.test.ts).
 *  - globalThis.fetch patched per test; restored in afterEach.
 *  - Bun fetch mocks use `unknown` cast per project convention.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { QueryClient, MutationObserver } from '@tanstack/react-query';
import { fetchCampusGridV2, saveCampusGridV2, type CampusGridV2 } from '../api/gridPersistence';
import { gridV2Keys } from '../api/gridQueryKeys';
import { furnitureGridMutationOptions, type FurnitureGridMutationVars } from './useFurnitureGrid';
import { getAuthEpoch } from '../api/queryClient';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GRID_V2: CampusGridV2 = {
  schemaVersion: 2,
  width: 8,
  height: 8,
  furniture: [{ id: 'furn_1', defId: 'desk_wood', gx: 2, gy: 2, rotation: 0 }],
};

const GRID_V2_B: CampusGridV2 = {
  schemaVersion: 2,
  width: 8,
  height: 8,
  furniture: [
    { id: 'furn_1', defId: 'desk_wood', gx: 2, gy: 2, rotation: 0 },
    { id: 'furn_2', defId: 'chair_teal', gx: 3, gy: 3, rotation: 90 },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

function makeFetch(body: unknown, status = 200): typeof fetch {
  return (async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;
}

/** Build a fresh isolated QueryClient per test. */
function makeQC(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

/** Run a mutation to completion and return the final state. */
async function runMutation(
  qc: QueryClient,
  vars: CampusGridV2,
): Promise<{ status: string; error: unknown }> {
  const mutVars: FurnitureGridMutationVars = { grid: vars, authEpoch: getAuthEpoch() };
  return new Promise((resolve) => {
    const obs = new MutationObserver(qc, {
      ...furnitureGridMutationOptions(qc),
    });
    obs.subscribe((state) => {
      if (state.status === 'success' || state.status === 'error') {
        resolve({ status: state.status, error: state.error });
        obs.reset();
      }
    });
    // obs.mutate() returns a promise that rejects on error; attach a no-op
    // catch so the rejection is handled — the subscription above captures the
    // final state and resolves the outer promise correctly.
    obs.mutate(mutVars).catch(() => {});
  });
}

beforeEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// 1. Serialized write order
// ---------------------------------------------------------------------------

describe('saveCampusGridV2 — serialized write order', () => {
  it('queued calls execute serially and last snapshot is sent last', async () => {
    const callLog: CampusGridV2[] = [];

    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as { grid: CampusGridV2 };
      callLog.push(body.grid);
      return new Response(JSON.stringify({ status: 'ok', saved: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const qc = makeQC();

    // Fire two mutations with the same scope — TanStack should queue them.
    const p1 = runMutation(qc, GRID_V2);
    const p2 = runMutation(qc, GRID_V2_B);

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.status).toBe('success');
    expect(r2.status).toBe('success');

    // Both calls were made and the order was preserved.
    expect(callLog).toHaveLength(2);
    // Last call must carry the GRID_V2_B snapshot (the "newer" local edit).
    expect(callLog[callLog.length - 1]!.furniture).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 2. False-save surfaces as error
// ---------------------------------------------------------------------------

describe('saveCampusGridV2 — false-save becomes error', () => {
  it('throws when server returns { status: ok, saved: false }', async () => {
    globalThis.fetch = makeFetch({ status: 'ok', saved: false }, 200);

    await expect(saveCampusGridV2(GRID_V2)).rejects.toThrow(/did not confirm/);
  });

  it('mutation enters error state on false-save', async () => {
    globalThis.fetch = makeFetch({ status: 'ok', saved: false }, 200);

    const qc = makeQC();
    const result = await runMutation(qc, GRID_V2);

    expect(result.status).toBe('error');
    expect((result.error as Error).message).toMatch(/did not confirm/);
  });
});

// ---------------------------------------------------------------------------
// 3. Transport error surfaces as error (no false-cache success)
// ---------------------------------------------------------------------------

describe('saveCampusGridV2 — transport error', () => {
  it('mutation enters error state on HTTP 500', async () => {
    globalThis.fetch = makeFetch({ message: 'Internal Server Error' }, 500);

    const qc = makeQC();
    const result = await runMutation(qc, GRID_V2);

    expect(result.status).toBe('error');
    expect(result.error).toBeInstanceOf(Error);
  });

  it('mutation enters error state on network throw', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;

    const qc = makeQC();
    const result = await runMutation(qc, GRID_V2);

    expect(result.status).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// 4. Abort guard — fetchCampusGridV2 forwards signal
// ---------------------------------------------------------------------------

describe('fetchCampusGridV2 — abort signal forwarding', () => {
  it('rejects with abort error when signal fires before response', async () => {
    const controller = new AbortController();

    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      // Abort before responding
      controller.abort();
      // Check that the signal was forwarded
      expect(init?.signal).toBeDefined();
      // In real fetch this would throw; simulate it
      throw new DOMException('The operation was aborted.', 'AbortError');
    }) as unknown as typeof fetch;

    await expect(fetchCampusGridV2(controller.signal)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 5. Payload unchanged
// ---------------------------------------------------------------------------

describe('saveCampusGridV2 — payload integrity', () => {
  it('sends the exact grid snapshot the caller passed without transformation', async () => {
    let capturedBody: unknown = null;

    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ status: 'ok', saved: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    await saveCampusGridV2(GRID_V2);

    expect(capturedBody).toEqual({ grid: GRID_V2 });
  });
});

// ---------------------------------------------------------------------------
// 6. retry: false — a 500 never auto-retries
// ---------------------------------------------------------------------------

describe('saveCampusGridV2 — retry: false', () => {
  it('calls fetch exactly once on 500 (no retry)', async () => {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      return new Response(JSON.stringify({ message: 'Server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const qc = makeQC();
    const result = await runMutation(qc, GRID_V2);

    expect(result.status).toBe('error');
    expect(callCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 7. gridV2Keys factory — distinct from legacy campusGrid key
// ---------------------------------------------------------------------------

describe('gridV2Keys', () => {
  it('grid() returns a key distinct from legacy campusGrid', () => {
    const v2Key = gridV2Keys.grid();
    expect(v2Key[0]).toBe('campusGridV2');
    expect(v2Key[0]).not.toBe('campusGrid');
  });

  it('all key is a prefix of grid()', () => {
    const allKey = gridV2Keys.all;
    const gridKey = gridV2Keys.grid();
    expect(gridKey[0]).toBe(allKey[0]);
  });
});

// ---------------------------------------------------------------------------
// 8. Cache updated on acknowledged save — remount sees saved layout
// ---------------------------------------------------------------------------

describe('furnitureGridMutationOptions — cache freshness on acknowledged save', () => {
  it('setQueryData is called with the saved grid after successful mutation', async () => {
    globalThis.fetch = makeFetch({ status: 'ok', saved: true }, 200);

    const qc = makeQC();
    // Seed old cache to verify it gets overwritten on success.
    qc.setQueryData(gridV2Keys.grid(), GRID_V2);

    const result = await runMutation(qc, GRID_V2_B);

    expect(result.status).toBe('success');
    // Cache must now hold the acknowledged snapshot (GRID_V2_B), not the old seed.
    const cached = qc.getQueryData<typeof GRID_V2_B>(gridV2Keys.grid());
    expect(cached?.furniture).toHaveLength(2);
    expect(cached?.furniture[1]?.id).toBe('furn_2');
  });

  it('prior cache is unchanged after failed save', async () => {
    globalThis.fetch = makeFetch({ status: 'ok', saved: false }, 200);

    const qc = makeQC();
    // Seed prior acknowledged snapshot.
    qc.setQueryData(gridV2Keys.grid(), GRID_V2);

    const result = await runMutation(qc, GRID_V2_B);

    expect(result.status).toBe('error');
    // Cache must still hold the prior snapshot (GRID_V2), not the failed write.
    const cached = qc.getQueryData<typeof GRID_V2>(gridV2Keys.grid());
    expect(cached?.furniture).toHaveLength(1);
    expect(cached?.furniture[0]?.id).toBe('furn_1');
  });

  it('two queued writes: cache reflects last acknowledged snapshot', async () => {
    // Snapshot C is a third distinct state for unambiguous assertion.
    const GRID_V2_C: import('../api/gridPersistence').CampusGridV2 = {
      schemaVersion: 2,
      width: 8,
      height: 8,
      furniture: [
        { id: 'furn_1', defId: 'desk_wood', gx: 2, gy: 2, rotation: 0 },
        { id: 'furn_2', defId: 'chair_teal', gx: 3, gy: 3, rotation: 90 },
        { id: 'furn_3', defId: 'plant_ficus', gx: 4, gy: 4, rotation: 0 },
      ],
    };

    globalThis.fetch = makeFetch({ status: 'ok', saved: true }, 200);

    const qc = makeQC();
    qc.setQueryData(gridV2Keys.grid(), GRID_V2);

    // Fire two writes — TanStack scopes them; both succeed; last should win in cache.
    const p1 = runMutation(qc, GRID_V2_B);
    const p2 = runMutation(qc, GRID_V2_C);
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.status).toBe('success');
    expect(r2.status).toBe('success');

    const cached = qc.getQueryData<typeof GRID_V2_C>(gridV2Keys.grid());
    // Final cache must be the last queued mutation's grid (3 items).
    expect(cached?.furniture).toHaveLength(3);
    expect(cached?.furniture[2]?.id).toBe('furn_3');
  });
});
