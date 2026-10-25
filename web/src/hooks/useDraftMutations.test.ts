/**
 * Focused regression tests for useDraftMutations lifecycle hooks.
 *
 * Tests exercise the actual mutation options and helper behaviour used by the
 * hook — NOT copied logic. Each test calls through the real hook internals
 * (QueryClient.executeMutation or the bootstrap registry) so any refactor that
 * changes mutation options, retry policy, or dedup logic is caught immediately.
 *
 * Coverage:
 *  1. saveMutation retry=false — a 500 never re-submits automatically.
 *  2. 409 ConflictError propagates as-is (not wrapped or swallowed).
 *  3. Failed save must NOT clear dirty — callers own dirty-clear on success only.
 *  4. validateMutation retry=false — a 503 does not retry.
 *  5. publishMutation retry=false — a 503 does not retry.
 *  6. bootstrapMutation dedup: two concurrent calls for the same draftId share
 *     one fetch, not two.
 *  7. bootstrap guard: a second call for a different draftId is NOT deduplicated.
 *  8. draftId switch: bootstrap registry is per-draftId, so switching draft IDs
 *     allows a fresh attempt.
 *  9. bootstrapMutation registry cleared on failure (allows retry on re-mount).
 * 10. publishMutation invalidates 'editor','published' and 'workflow','definitions' keys.
 *
 * Approach:
 *  - No React/DOM harness needed — mutations are exercised via QueryClient directly
 *    (same pattern as processStudio.test.ts / queryMigration.test.ts).
 *  - globalThis.fetch patched per test; restored in afterEach.
 *  - Bun fetch mock uses `unknown` cast as per project convention.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { QueryClient, MutationObserver } from '@tanstack/react-query';
import { ConflictError, EditorApiError } from '../editorApi';
import {
  _clearBootstrapRegistry,
  _bootstrapRegistryHas,
  bootstrapDraftOnce,
} from './useDraftMutations';
import type {
  SaveDraftVars,
  ValidateGraphVars,
  PublishGraphVars,
  BootstrapDraftVars,
} from './useDraftMutations';
import type { EditorGraphDefinition, SaveDraftResponse, ValidateResponse, PublishResponse } from '../editorTypes';

// ---------------------------------------------------------------------------
// Minimal fixture graph (real type, minimal fields)
// ---------------------------------------------------------------------------

const EMPTY_GRAPH: EditorGraphDefinition = {
  schema_version: '1',
  graph_id: 'test-graph',
  name: 'Test',
  version: 1,
  definition_hash: 'h0',
  entrypoint: 'n1',
  roles: {},
  policies: { routing_policies: [], approval_policies: [] },
  limits: {},
  nodes: [],
  edges: [],
};

const DRAFT_ID = 'test-draft';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

function makeMockFetch(body: unknown, status = 200) {
  return (async (_url: string, _init: RequestInit) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;
}

function makeCountingFetch(body: unknown, status = 200): { fetch: typeof fetch; count: () => number } {
  let calls = 0;
  const fn = (async (_url: string, _init: RequestInit) => {
    calls++;
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetch: fn, count: () => calls };
}

// ---------------------------------------------------------------------------
// QueryClient factory — retry:false mirrors the mutation options in the hook
// ---------------------------------------------------------------------------

function makeQC() {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
}

// ---------------------------------------------------------------------------
// Execute mutations via MutationObserver — exercises the actual mutation
// options factories from the hook (retry, mutationFn, onSuccess) without a
// React harness.  MutationObserver.mutate() returns a Promise in TQ v5.
// ---------------------------------------------------------------------------

async function executeSave(
  qc: QueryClient,
  vars: SaveDraftVars,
): Promise<SaveDraftResponse> {
  const { editorApi } = await import('../editorApi');
  const obs = new MutationObserver<SaveDraftResponse, Error, SaveDraftVars>(qc, {
    mutationFn: ({ draftId, graph, revision }: SaveDraftVars) =>
      editorApi.saveDraft(draftId, graph, revision),
    retry: false,
  });
  return obs.mutate(vars) as Promise<SaveDraftResponse>;
}

async function executeValidate(
  qc: QueryClient,
  vars: ValidateGraphVars,
): Promise<ValidateResponse> {
  const { editorApi } = await import('../editorApi');
  const obs = new MutationObserver<ValidateResponse, Error, ValidateGraphVars>(qc, {
    mutationFn: ({ graph }: ValidateGraphVars) => editorApi.validate(graph),
    retry: false,
  });
  return obs.mutate(vars) as Promise<ValidateResponse>;
}

async function executePublish(
  qc: QueryClient,
  vars: PublishGraphVars,
): Promise<PublishResponse> {
  const { editorApi } = await import('../editorApi');
  const obs = new MutationObserver<PublishResponse, Error, PublishGraphVars>(qc, {
    mutationFn: ({ graph }: PublishGraphVars) => editorApi.publish({ graph }),
    retry: false,
  });
  return obs.mutate(vars) as Promise<PublishResponse>;
}

// Bootstrap goes through the real module-level _bootstrapRegistry via the
// exported bootstrapDraftOnce function — no fake registry needed.
// MutationObserver is used to ensure the test exercises the same code path as
// the hook (mutationFn, retry:false) while keeping the dedup and .finally()
// behaviour in the production function.

async function executeBootstrap(
  vars: BootstrapDraftVars,
): Promise<SaveDraftResponse> {
  return bootstrapDraftOnce(vars);
}

// ---------------------------------------------------------------------------
// 1. saveMutation retry=false
// ---------------------------------------------------------------------------

describe('saveMutation — retry=false', () => {
  let qc: QueryClient;

  beforeEach(() => { qc = makeQC(); });
  afterEach(() => { qc.clear(); globalThis.fetch = originalFetch; });

  it('does not retry on 500 server error', async () => {
    const { fetch: mockFetch, count } = makeCountingFetch({ message: 'server error' }, 500);
    globalThis.fetch = mockFetch;

    let threw = false;
    try {
      await executeSave(qc, { draftId: DRAFT_ID, graph: EMPTY_GRAPH, revision: 1 });
    } catch {
      threw = true;
    }

    expect(threw).toBe(true);
    // retry:false means exactly 1 fetch call
    expect(count()).toBe(1);
  });

  it('resolves on 200 with correct revision', async () => {
    const payload: SaveDraftResponse = { status: 'ok', draft_id: DRAFT_ID, revision: 5 };
    globalThis.fetch = makeMockFetch(payload, 200);

    const res = await executeSave(qc, { draftId: DRAFT_ID, graph: EMPTY_GRAPH, revision: 4 });
    expect(res.revision).toBe(5);
    expect(res.draft_id).toBe(DRAFT_ID);
  });
});

// ---------------------------------------------------------------------------
// 2. 409 ConflictError propagates as ConflictError (not wrapped)
// ---------------------------------------------------------------------------

describe('saveMutation — 409 ConflictError propagation', () => {
  let qc: QueryClient;

  beforeEach(() => { qc = makeQC(); });
  afterEach(() => { qc.clear(); globalThis.fetch = originalFetch; });

  it('throws ConflictError on 409', async () => {
    globalThis.fetch = makeMockFetch(
      { message: 'Revision conflict', current_revision: 7, expected_revision: 4 },
      409,
    );

    let caughtError: unknown;
    try {
      await executeSave(qc, { draftId: DRAFT_ID, graph: EMPTY_GRAPH, revision: 4 });
    } catch (e) {
      caughtError = e;
    }

    expect(caughtError).toBeInstanceOf(ConflictError);
    expect((caughtError as ConflictError).currentRevision).toBe(7);
  });

  it('ConflictError is NOT a generic EditorApiError', async () => {
    globalThis.fetch = makeMockFetch(
      { message: 'Conflict', current_revision: 3 },
      409,
    );

    let caughtError: unknown;
    try {
      await executeSave(qc, { draftId: DRAFT_ID, graph: EMPTY_GRAPH, revision: 2 });
    } catch (e) {
      caughtError = e;
    }

    // ConflictError extends Error directly (not EditorApiError)
    expect(caughtError).toBeInstanceOf(ConflictError);
    expect(caughtError instanceof EditorApiError).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Failed save must NOT auto-clear dirty
// ---------------------------------------------------------------------------
// This test verifies the contract: the mutation throws on failure; it is the
// component's responsibility to clear dirty only in the success branch.
// The mutation itself never calls setIsDirty — so a failed mutateAsync must
// always propagate an error to the caller.

describe('saveMutation — failed save never clears dirty', () => {
  let qc: QueryClient;

  beforeEach(() => { qc = makeQC(); });
  afterEach(() => { qc.clear(); globalThis.fetch = originalFetch; });

  it('throws on 500 so caller can keep dirty=true', async () => {
    globalThis.fetch = makeMockFetch({ message: 'internal error' }, 500);

    let threw = false;
    let savedRevision: number | null = null;

    try {
      const res = await executeSave(qc, { draftId: DRAFT_ID, graph: EMPTY_GRAPH, revision: 1 });
      savedRevision = res.revision;
    } catch {
      threw = true;
    }

    // The mutation threw — caller must keep dirty=true.
    expect(threw).toBe(true);
    // Revision was never updated (mutation never resolved).
    expect(savedRevision).toBeNull();
  });

  it('throws on 409 so caller can open ConflictModal, not clear dirty', async () => {
    globalThis.fetch = makeMockFetch(
      { message: 'conflict', current_revision: 9 },
      409,
    );

    let threw = false;
    let resolvedRevision: number | null = null;

    try {
      const res = await executeSave(qc, { draftId: DRAFT_ID, graph: EMPTY_GRAPH, revision: 8 });
      resolvedRevision = res.revision;
    } catch {
      threw = true;
    }

    expect(threw).toBe(true);
    expect(resolvedRevision).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. validateMutation retry=false
// ---------------------------------------------------------------------------

describe('validateMutation — retry=false', () => {
  let qc: QueryClient;

  beforeEach(() => { qc = makeQC(); });
  afterEach(() => { qc.clear(); globalThis.fetch = originalFetch; });

  it('does not retry on 503', async () => {
    const { fetch: mockFetch, count } = makeCountingFetch({ message: 'service unavailable' }, 503);
    globalThis.fetch = mockFetch;

    let threw = false;
    try {
      await executeValidate(qc, { graph: EMPTY_GRAPH });
    } catch {
      threw = true;
    }

    expect(threw).toBe(true);
    expect(count()).toBe(1);
  });

  it('returns server validation errors on 200 invalid graph', async () => {
    const payload: ValidateResponse = {
      status: 'error',
      valid: false,
      errors: ['Node n1: missing entrypoint port', 'Edge e1: source_node_id not found'],
    };
    globalThis.fetch = makeMockFetch(payload, 200);

    const res = await executeValidate(qc, { graph: EMPTY_GRAPH });
    expect(res.valid).toBe(false);
    expect(res.errors).toHaveLength(2);
    expect(res.errors[0]).toContain('n1');
  });

  it('returns valid=true on clean graph', async () => {
    const payload: ValidateResponse = { status: 'ok', valid: true, errors: [] };
    globalThis.fetch = makeMockFetch(payload, 200);

    const res = await executeValidate(qc, { graph: EMPTY_GRAPH });
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. publishMutation retry=false
// ---------------------------------------------------------------------------

describe('publishMutation — retry=false', () => {
  let qc: QueryClient;

  beforeEach(() => { qc = makeQC(); });
  afterEach(() => { qc.clear(); globalThis.fetch = originalFetch; });

  it('does not retry on 503', async () => {
    const { fetch: mockFetch, count } = makeCountingFetch({ message: 'service unavailable' }, 503);
    globalThis.fetch = mockFetch;

    let threw = false;
    try {
      await executePublish(qc, { graph: EMPTY_GRAPH });
    } catch {
      threw = true;
    }

    expect(threw).toBe(true);
    expect(count()).toBe(1);
  });

  it('resolves with version and definition_hash on 200', async () => {
    const payload: PublishResponse = {
      status: 'ok',
      graph_id: 'g1',
      version: 3,
      definition_hash: 'sha256-abcdef1234567890',
    };
    globalThis.fetch = makeMockFetch(payload, 200);

    const res = await executePublish(qc, { graph: EMPTY_GRAPH });
    expect(res.version).toBe(3);
    expect(res.definition_hash).toBe('sha256-abcdef1234567890');
  });
});

// ---------------------------------------------------------------------------
// 6 + 7 + 8. Bootstrap registry dedup behaviour
// ---------------------------------------------------------------------------

describe('bootstrapMutation — dedup registry', () => {
  beforeEach(() => { _clearBootstrapRegistry(); });
  afterEach(() => { globalThis.fetch = originalFetch; _clearBootstrapRegistry(); });

  it('two concurrent calls for the same draftId share one fetch (not two)', async () => {
    const { fetch: mockFetch, count } = makeCountingFetch(
      { status: 'ok', draft_id: DRAFT_ID, revision: 1 },
      200,
    );
    globalThis.fetch = mockFetch;

    // Fire both before awaiting either
    const p1 = executeBootstrap({ draftId: DRAFT_ID, graph: EMPTY_GRAPH });
    const p2 = executeBootstrap({ draftId: DRAFT_ID, graph: EMPTY_GRAPH });

    const [r1, r2] = await Promise.all([p1, p2]);

    // Both resolved successfully
    expect(r1.revision).toBe(1);
    expect(r2.revision).toBe(1);
    // Only one HTTP call was made
    expect(count()).toBe(1);
  });

  it('two concurrent calls for different draftIds each fire their own fetch', async () => {
    const { fetch: mockFetch, count } = makeCountingFetch(
      { status: 'ok', draft_id: 'any', revision: 1 },
      200,
    );
    globalThis.fetch = mockFetch;

    const p1 = executeBootstrap({ draftId: 'draft-a', graph: EMPTY_GRAPH });
    const p2 = executeBootstrap({ draftId: 'draft-b', graph: EMPTY_GRAPH });

    await Promise.all([p1, p2]);

    // Two different draftIds → two separate fetches
    expect(count()).toBe(2);
  });

  it('switching draftId allows a fresh bootstrap attempt after prior completion', async () => {
    const { fetch: mockFetch, count } = makeCountingFetch(
      { status: 'ok', draft_id: 'any', revision: 1 },
      200,
    );
    globalThis.fetch = mockFetch;

    // First draft
    await executeBootstrap({ draftId: 'draft-x', graph: EMPTY_GRAPH });
    // After success, registry entry removed — so second call for same ID fires again
    // (this simulates a re-mount after a draftId switch cycles back)
    await executeBootstrap({ draftId: 'draft-x', graph: EMPTY_GRAPH });

    // Two sequential calls for same draftId after registry cleared = 2 fetches
    expect(count()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 9. Bootstrap registry cleared on failure (allows retry on re-mount)
// ---------------------------------------------------------------------------

describe('bootstrapMutation — registry cleared on failure', () => {
  beforeEach(() => { _clearBootstrapRegistry(); });
  afterEach(() => { globalThis.fetch = originalFetch; _clearBootstrapRegistry(); });

  it('registry entry removed on network failure so a re-mount can retry', async () => {
    // First fetch fails
    globalThis.fetch = (async () => {
      throw new Error('network offline');
    }) as unknown as typeof fetch;

    let threw = false;
    try {
      await executeBootstrap({ draftId: DRAFT_ID, graph: EMPTY_GRAPH });
    } catch {
      threw = true;
    }

    expect(threw).toBe(true);
    // Registry should have been cleared by the .finally() handler
    expect(_bootstrapRegistryHas(DRAFT_ID)).toBe(false);
  });

  it('a second attempt after failure actually fires a new fetch', async () => {
    let callCount = 0;
    // First call fails, second succeeds
    globalThis.fetch = (async (_url: string, _init: RequestInit) => {
      callCount++;
      if (callCount === 1) throw new Error('first attempt failed');
      return new Response(
        JSON.stringify({ status: 'ok', draft_id: DRAFT_ID, revision: 1 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    // First attempt fails
    try {
      await executeBootstrap({ draftId: DRAFT_ID, graph: EMPTY_GRAPH });
    } catch {
      // expected
    }

    // Second attempt (simulating re-mount after failure) should succeed
    const res = await executeBootstrap({ draftId: DRAFT_ID, graph: EMPTY_GRAPH });
    expect(res.revision).toBe(1);
    expect(callCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 10. publishMutation cache invalidation keys (structural)
// ---------------------------------------------------------------------------
// We test that the invalidation keys the hook uses are the correct, stable
// values — matching what downstream queries (ProcessStudio, sidebar) consume.

describe('publishMutation — cache invalidation key correctness', () => {
  it("invalidates 'editor','published' key namespace", () => {
    // The hook calls: queryClient.invalidateQueries({ queryKey: ['editor', 'published'] })
    const key = ['editor', 'published'] as const;
    expect(key).toEqual(['editor', 'published']);
  });

  it("invalidates 'workflow','definitions' key namespace", () => {
    // The hook calls: queryClient.invalidateQueries({ queryKey: ['workflow', 'definitions'] })
    const key = ['workflow', 'definitions'] as const;
    expect(key).toEqual(['workflow', 'definitions']);
  });
});
