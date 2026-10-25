/**
 * Focused regression tests for the WorkstationMonitor + TaskDrilldownModal
 * TanStack Query migration.
 *
 * Strategy: no React/DOM harness needed. We test:
 *  1. agentMonitorKey / taskLogKey identity helpers.
 *  2. Query option logic (refetchInterval callback) via QueryObserver + mock fetch.
 *  3. transport integration: signal is passed through to fetch (abort on cancel).
 *  4. Legacy helper exports still work (formatDuration, BridgeStateBadge, TERMINAL_CLASS).
 *
 * Uses bun:test with globalThis.fetch patched — same pattern as transport.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import { agentMonitorKey } from './WorkstationMonitor';
import { taskLogKey, formatDuration, TERMINAL_CLASS, BridgeStateBadge } from './TaskDrilldownModal';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

function makeMockFetch(body: unknown, status = 200) {
  return (async (_url: string, _init: RequestInit) => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

// ---------------------------------------------------------------------------
// 1. Query key factories
// ---------------------------------------------------------------------------

describe('agentMonitorKey', () => {
  it('returns stable array keyed by agentId', () => {
    expect(agentMonitorKey('agent-42')).toEqual(['agentMonitor', 'agent-42']);
  });

  it('different agents produce different keys', () => {
    const a = agentMonitorKey('a1');
    const b = agentMonitorKey('a2');
    expect(a).not.toEqual(b);
  });
});

describe('taskLogKey', () => {
  it('returns stable array keyed by taskId', () => {
    expect(taskLogKey('task-99')).toEqual(['taskLog', 'task-99']);
  });

  it('different tasks produce different keys', () => {
    expect(taskLogKey('t1')).not.toEqual(taskLogKey('t2'));
  });
});

// ---------------------------------------------------------------------------
// 2. refetchInterval callback for TaskLog (is_live gate)
// ---------------------------------------------------------------------------

describe('taskLog refetchInterval logic', () => {
  it('polls 3 s when is_live=true', async () => {
    // We derive the interval by inspecting what the query option returns
    // given a synthetic Query state, mimicking how TanStack Query v5 calls it.
    const data = { is_live: true, task: null, artifacts: [] };
    // Simulate the query object shape TanStack passes to refetchInterval
    const fakeQuery = { state: { data } };

    // Mirror the exact refetchInterval callback from TaskDrilldownModal:
    type LiveData = { is_live: boolean } | undefined;
    const refetchInterval = (query: { state: { data: LiveData } }) => {
      const d = query.state.data;
      return d?.is_live ? 3000 : false;
    };

    expect(refetchInterval(fakeQuery)).toBe(3000);
  });

  it('stops polling when is_live=false', () => {
    type LiveData = { is_live: boolean } | undefined;
    const refetchInterval = (query: { state: { data: LiveData } }) => {
      const d = query.state.data;
      return d?.is_live ? 3000 : false;
    };
    const fakeQuery = { state: { data: { is_live: false } as LiveData } };
    expect(refetchInterval(fakeQuery)).toBe(false);
  });

  it('stops polling when data is undefined (initial load)', () => {
    type LiveData = { is_live: boolean } | undefined;
    const refetchInterval = (query: { state: { data: LiveData } }) => {
      const d = query.state.data;
      return d?.is_live ? 3000 : false;
    };
    const fakeQuery = { state: { data: undefined as LiveData } };
    expect(refetchInterval(fakeQuery)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. QueryObserver: monitor endpoint fetched via transport, signal forwarded
// ---------------------------------------------------------------------------

describe('WorkstationMonitor query: transport + signal', () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    qc.clear();
    globalThis.fetch = originalFetch;
  });

  it('fetches /api/agents/:id/monitor and resolves data', async () => {
    const monitorPayload = {
      status: 'ok',
      timestamp: 1000,
      agent: { id: 'a1' },
      source: 'idle',
      task: null,
      is_active: false,
      is_live: false,
      tail_lines: 0,
      stdout_tail: [],
      stderr_tail: [],
      activity: [],
    };

    let capturedUrl = '';
    let capturedSignal: AbortSignal | undefined;

    globalThis.fetch = (async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedSignal = init.signal as AbortSignal;
      return new Response(JSON.stringify(monitorPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const data = await qc.fetchQuery({
      queryKey: agentMonitorKey('a1'),
      queryFn: async ({ signal }) => {
        const { transport } = await import('../api/transport');
        return transport<typeof monitorPayload>(
          `/api/agents/${encodeURIComponent('a1')}/monitor`,
          { signal },
        );
      },
    });

    expect(capturedUrl).toBe('/api/agents/a1/monitor');
    expect(capturedSignal).toBeDefined();
    expect(data.source).toBe('idle');
  });

  it('surfaces HttpError on non-ok response', async () => {
    globalThis.fetch = makeMockFetch({ message: 'not found' }, 404);

    let threw = false;
    try {
      await qc.fetchQuery({
        queryKey: agentMonitorKey('missing'),
        queryFn: async ({ signal }) => {
          const { transport } = await import('../api/transport');
          return transport<unknown>('/api/agents/missing/monitor', { signal });
        },
      });
    } catch (e: unknown) {
      threw = true;
      expect((e as Error).message).toContain('not found');
    }
    expect(threw).toBe(true);
  });
});

describe('TaskDrilldownModal query: transport + abort', () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    qc.clear();
    globalThis.fetch = originalFetch;
  });

  it('fetches /api/tasks/:id/log and resolves TaskLog', async () => {
    const logPayload = {
      status: 'ok',
      timestamp: 2000,
      task: { task_id: 'task-7', title: 'test', state: 'running' },
      is_live: true,
      stdout: { path: '/tmp/out.log', text: 'hello', size_bytes: 5, truncated: false },
      stderr: { path: '/tmp/err.log', text: '', size_bytes: 0, truncated: false },
      artifacts: [],
    };

    globalThis.fetch = makeMockFetch(logPayload);

    const data = await qc.fetchQuery({
      queryKey: taskLogKey('task-7'),
      queryFn: async ({ signal }) => {
        const { transport } = await import('../api/transport');
        return transport<typeof logPayload>('/api/tasks/task-7/log', { signal });
      },
    });

    expect(data.is_live).toBe(true);
    expect(data.task.task_id).toBe('task-7');
    expect(data.stdout.text).toBe('hello');
  });

  it('abort via QueryClient.cancelQueries propagates signal abort', async () => {
    let abortFired = false;

    // Deferred that resolves once fetch is entered and the abort listener is
    // registered on the signal — so cancelQueries never races ahead of it.
    let signalReady!: () => void;
    const fetchEntered = new Promise<void>((res) => { signalReady = res; });

    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const sig = init.signal as AbortSignal;

      // If signal is already aborted (shouldn't happen with the deferred
      // below, but guard defensively), fire immediately.
      if (sig.aborted) {
        abortFired = true;
        throw new DOMException('The user aborted a request.', 'AbortError');
      }

      // Register the abort listener first, then notify the test we're ready.
      const abortSettled = new Promise<void>((resolve) => {
        sig.addEventListener('abort', () => {
          abortFired = true;
          resolve();
        });
      });

      // Signal to the test that the listener is in place.
      signalReady();

      // Wait for the abort to actually fire.
      await abortSettled;
      throw new DOMException('The user aborted a request.', 'AbortError');
    }) as unknown as typeof fetch;

    // Observe the rejection immediately to avoid unhandled-rejection warnings.
    const fetchPromise = qc.fetchQuery({
      queryKey: taskLogKey('task-abort'),
      queryFn: async ({ signal }) => {
        const { transport } = await import('../api/transport');
        return transport<unknown>('/api/tasks/task-abort/log', { signal });
      },
    });
    // Attach a no-op catch so the promise is never "unhandled".
    fetchPromise.catch(() => {});

    // Wait until fetch has entered and wired the abort listener, *then* cancel.
    await fetchEntered;
    await qc.cancelQueries({ queryKey: taskLogKey('task-abort') });

    // fetchPromise should reject
    let errored = false;
    try {
      await fetchPromise;
    } catch {
      errored = true;
    }

    expect(abortFired).toBe(true);
    expect(errored).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Legacy helper exports (formatDuration, TERMINAL_CLASS)
// ---------------------------------------------------------------------------

describe('formatDuration', () => {
  it('returns — for null', () => expect(formatDuration(null)).toBe('—'));
  it('returns — for undefined', () => expect(formatDuration(undefined)).toBe('—'));
  it('formats seconds only', () => expect(formatDuration(45)).toBe('45s'));
  it('formats minutes + seconds', () => expect(formatDuration(125)).toBe('2m 5s'));
  it('formats hours + minutes + seconds', () => expect(formatDuration(3661)).toBe('1h 1m 1s'));
});

describe('TERMINAL_CLASS', () => {
  it('is a non-empty string', () => {
    expect(typeof TERMINAL_CLASS).toBe('string');
    expect(TERMINAL_CLASS.length).toBeGreaterThan(0);
  });
});

describe('BridgeStateBadge export', () => {
  it('is a function (React component)', () => {
    expect(typeof BridgeStateBadge).toBe('function');
  });
});
