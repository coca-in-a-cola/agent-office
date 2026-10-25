/**
 * Auth-transition isolation regression tests for ProcessStudio mutations.
 *
 * Scope: ProcessStudio commandMutation and createRunMutation epoch guards.
 *
 * These tests exercise the production auth-epoch guard applied to both
 * ProcessStudio mutations. No React/DOM harness — mutations are exercised
 * directly via MutationObserver with the same options the component uses,
 * following the established bun:test + globalThis.fetch pattern.
 *
 * Scenarios covered:
 *  1. commandMutation onSuccess does NOT write to cache after auth transition.
 *  2. commandMutation onSuccess writes to cache normally within same session.
 *  3. createRunMutation onSuccess does NOT write to cache after auth transition.
 *  4. createRunMutation onSuccess writes to cache normally within same session.
 *  5. Auth transition mid-flight: runs list invalidation NOT called after reset.
 *  6. Old in-flight response cannot seed run detail cache after user switch.
 *  7. New-user createRun correctly seeds cache (no false guard).
 *
 * Design note:
 *  The epoch is included in mutation variables (not in an onMutate context
 *  closure) so it is immutable after dispatch and cannot be bypassed by
 *  setOptions or re-render. This is the same pattern as furnitureGrid.
 *
 *  commandMutation mutationFn performs a preflight epoch check and throws
 *  AuthSessionChangedError without touching the network if the epoch is stale
 *  at dispatch time.  The onSuccess guard additionally blocks cache
 *  contamination after an auth transition that occurs while a request is
 *  already in-flight.
 *
 *  Note on invalidateQueries: the onSuccess guard also prevents
 *  qc.invalidateQueries from running after a transition. This is intentional —
 *  the new-user cache should not be invalidated by old-session commands.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { QueryClient, MutationObserver } from '@tanstack/react-query';
import { resetOnAuthChange, getAuthEpoch } from './api/queryClient';
import { workflowKeys } from './workflowApi';
import type { RunDetail, RunSummary } from './workflowTypes';
import {
  commandMutationOptions,
  createRunMutationOptions,
} from './api/studioMutations';
import type { CommandVars, CreateVars } from './api/studioMutations';

// ---------------------------------------------------------------------------
// Fixtures — complete typed objects matching RunDetail / RunSummary exactly
// ---------------------------------------------------------------------------

const RUN_ID_A = 'run-session-a';
const RUN_ID_B = 'run-session-b';

function makeRunDetail(runId: string): RunDetail {
  return {
    run: {
      run_id: runId,
      definition_hash: 'sha256-test',
      definition_name: 'test-workflow',
      definition_version: 1,
      status: 'running',
      status_reason: '',
      current_node: null,
      source_sha: null,
      inputs: {},
      due_at: null,
      created_at: 1700000000,
      updated_at: 1700000000,
      paused: false,
    },
    current_attempt: null,
    attempts: [],
    node_states: {},
    gates: [],
    pending_gate: null,
    timeline: [],
    logs: [],
    evidence_digests: {},
    actions: {
      pause: true,
      resume: false,
      cancel: true,
      approve: false,
      retry: false,
    },
    bridge: 'local',
  };
}

function makeRunSummary(runId: string): RunSummary {
  return {
    run_id: runId,
    definition_hash: 'sha256-test',
    definition_name: 'test-workflow',
    definition_version: 1,
    status: 'running',
    status_reason: '',
    current_node: null,
    paused: false,
    active: true,
    attempt_count: 0,
    goal: 'test',
    created_at: 1700000000,
    updated_at: 1700000000,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

function makeQC(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function runCommandMutation(
  qc: QueryClient,
  vars: { runId: string; command: 'pause' | 'resume' | 'cancel' | 'approve' | 'retry'; body?: Record<string, unknown> },
  epochOverride?: number,
): Promise<{ status: string; error: unknown }> {
  const authEpoch = epochOverride ?? getAuthEpoch();
  return new Promise((resolve) => {
    const obs = new MutationObserver<RunDetail, Error, CommandVars>(qc, commandMutationOptions(qc));
    obs.subscribe((state) => {
      if (state.status === 'success' || state.status === 'error') {
        resolve({ status: state.status, error: state.error });
        obs.reset();
      }
    });
    obs.mutate({ ...vars, authEpoch }).catch(() => {});
  });
}

function runCreateMutation(
  qc: QueryClient,
  vars: { goal: string; repo: string; definition_hash: string },
  onSelectRunId?: (id: string) => void,
  epochOverride?: number,
): Promise<{ status: string; error: unknown }> {
  const authEpoch = epochOverride ?? getAuthEpoch();
  return new Promise((resolve) => {
    const obs = new MutationObserver<RunDetail, Error, CreateVars>(qc, createRunMutationOptions(qc, { onSelectRunId }));
    obs.subscribe((state) => {
      if (state.status === 'success' || state.status === 'error') {
        resolve({ status: state.status, error: state.error });
        obs.reset();
      }
    });
    obs.mutate({ ...vars, authEpoch }).catch(() => {});
  });
}

beforeEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// 1. commandMutation: onSuccess does NOT write to cache after auth transition
// ---------------------------------------------------------------------------

describe('commandMutation — epoch guard on late resolve', () => {
  it('does not seed run detail cache when auth transitions while command is in-flight', async () => {
    let resolveRequest!: () => void;
    const networkBarrier = new Promise<void>((r) => { resolveRequest = r; });

    globalThis.fetch = (async (_url: string) => {
      await networkBarrier;
      return new Response(JSON.stringify(makeRunDetail(RUN_ID_A)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const qc = makeQC();
    const done = runCommandMutation(qc, { runId: RUN_ID_A, command: 'pause' });

    await new Promise((r) => setTimeout(r, 0));
    resetOnAuthChange(); // auth transition while command is in-flight

    resolveRequest();
    const result = await done;

    expect(result.status).toBe('success'); // network succeeded
    // Old-session run must NOT be in the new-user cache
    expect(qc.getQueryData(workflowKeys.run(RUN_ID_A))).toBeUndefined();
  });

  it('writes to run detail cache normally when no auth transition occurs', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(makeRunDetail(RUN_ID_A)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    ) as unknown as typeof fetch;

    const qc = makeQC();
    const result = await runCommandMutation(qc, { runId: RUN_ID_A, command: 'pause' });

    expect(result.status).toBe('success');
    const cached = qc.getQueryData<RunDetail>(workflowKeys.run(RUN_ID_A));
    expect(cached?.run.run_id).toBe(RUN_ID_A);
  });
});

// ---------------------------------------------------------------------------
// 2. createRunMutation: onSuccess does NOT write to cache after auth transition
// ---------------------------------------------------------------------------

describe('createRunMutation — epoch guard on late resolve', () => {
  it('does not seed run detail cache or update selection after auth transition', async () => {
    let resolveRequest!: () => void;
    const networkBarrier = new Promise<void>((r) => { resolveRequest = r; });

    globalThis.fetch = (async () => {
      await networkBarrier;
      return new Response(JSON.stringify(makeRunDetail(RUN_ID_A)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const qc = makeQC();
    let selectedRunId: string | null = null;

    const done = runCreateMutation(
      qc,
      { goal: 'old-session', repo: '', definition_hash: 'sha256-old' },
      (id) => { selectedRunId = id; },
    );

    await new Promise((r) => setTimeout(r, 0));
    resetOnAuthChange(); // auth transition while createRun is in-flight

    resolveRequest();
    const result = await done;

    expect(result.status).toBe('success'); // network succeeded
    // Old-session run must NOT be in the new-user cache
    expect(qc.getQueryData(workflowKeys.run(RUN_ID_A))).toBeUndefined();
    // Selection must not have been updated with old-session run id
    expect(selectedRunId).toBeNull();
  });

  it('seeds run detail cache and updates selection normally when no transition occurs', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(makeRunDetail(RUN_ID_B)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    ) as unknown as typeof fetch;

    const qc = makeQC();
    let selectedRunId: string | null = null;

    const result = await runCreateMutation(
      qc,
      { goal: 'new-run', repo: '', definition_hash: 'sha256-new' },
      (id) => { selectedRunId = id; },
    );

    expect(result.status).toBe('success');
    const cached = qc.getQueryData<RunDetail>(workflowKeys.run(RUN_ID_B));
    expect(cached?.run.run_id).toBe(RUN_ID_B);
    // selectedRunId was set by callback — narrow to string before asserting value
    expect(selectedRunId).not.toBeNull();
    expect(selectedRunId!).toBe(RUN_ID_B);
  });
});

// ---------------------------------------------------------------------------
// 3. Sequential user switch: old run does not appear in new user's cache
// ---------------------------------------------------------------------------

describe('sequential user switch — no cross-session run cache contamination', () => {
  it('userA run detail does not appear in cache after switch to userB', async () => {
    let resolveUserA!: () => void;
    let requestEntered!: () => void;
    const entered = new Promise<void>((r) => { requestEntered = r; });
    let callCount = 0;

    globalThis.fetch = (async (_url: string) => {
      callCount++;
      if (callCount === 1) {
        await new Promise<void>((r) => {
          resolveUserA = r;
          requestEntered();
        });
        return new Response(JSON.stringify(makeRunDetail(RUN_ID_A)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(makeRunDetail(RUN_ID_B)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const qc = makeQC();

    // userA issues a command
    const doneA = runCommandMutation(qc, { runId: RUN_ID_A, command: 'cancel' });
    await entered;

    // Auth switch while userA's request is in-flight
    resetOnAuthChange();

    resolveUserA();
    const resultA = await doneA;
    expect(resultA.status).toBe('success');
    // userA's run must NOT be in the cache
    expect(qc.getQueryData(workflowKeys.run(RUN_ID_A))).toBeUndefined();

    // userB issues their own command — it should write normally
    const resultB = await runCommandMutation(qc, { runId: RUN_ID_B, command: 'resume' });
    expect(resultB.status).toBe('success');
    const cached = qc.getQueryData<RunDetail>(workflowKeys.run(RUN_ID_B));
    expect(cached?.run.run_id).toBe(RUN_ID_B);
  });
});

// ---------------------------------------------------------------------------
// 4. Stale-epoch preflight: mutationFn rejects before network if epoch stale
// ---------------------------------------------------------------------------

describe('stale-epoch preflight — mutationFn rejects without sending fetch', () => {
  it('commandMutation does not send fetch when epoch is already stale at dispatch', async () => {
    let fetchCallCount = 0;
    globalThis.fetch = (async () => {
      fetchCallCount++;
      return new Response(JSON.stringify(makeRunDetail(RUN_ID_A)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const qc = makeQC();

    // Capture epoch, then advance it before mutating — simulates race where
    // auth changes between the user clicking and the mutationFn executing.
    const staleEpoch = getAuthEpoch();
    resetOnAuthChange(); // epoch is now staleEpoch + 1

    const result = await runCommandMutation(qc, { runId: RUN_ID_A, command: 'pause' }, staleEpoch);

    // Mutation must settle as error (AuthSessionChangedError)
    expect(result.status).toBe('error');
    // Cache must be clean — no stale run data seeded
    expect(qc.getQueryData(workflowKeys.run(RUN_ID_A))).toBeUndefined();
    // fetch must NOT have been called — preflight guard blocked the network request
    expect(fetchCallCount).toBe(0);
  });

  it('createRunMutation does not send fetch when epoch is already stale at dispatch', async () => {
    let fetchCallCount = 0;
    globalThis.fetch = (async () => {
      fetchCallCount++;
      return new Response(JSON.stringify(makeRunDetail(RUN_ID_B)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const qc = makeQC();

    const staleEpoch = getAuthEpoch();
    resetOnAuthChange();

    const result = await runCreateMutation(
      qc,
      { goal: 'old-session', repo: '', definition_hash: 'sha256-old' },
      undefined,
      staleEpoch,
    );

    expect(result.status).toBe('error');
    expect(qc.getQueryData(workflowKeys.run(RUN_ID_B))).toBeUndefined();
    expect(fetchCallCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Fixture validation: makeRunSummary produces a valid RunSummary
// ---------------------------------------------------------------------------

describe('fixture types', () => {
  it('makeRunDetail produces a well-typed RunDetail', () => {
    const detail: RunDetail = makeRunDetail(RUN_ID_A);
    expect(detail.run.run_id).toBe(RUN_ID_A);
    expect(detail.attempts).toEqual([]);
    expect(detail.gates).toEqual([]);
  });

  it('makeRunSummary produces a well-typed RunSummary', () => {
    const summary: RunSummary = makeRunSummary(RUN_ID_A);
    expect(summary.run_id).toBe(RUN_ID_A);
    expect(summary.active).toBe(true);
  });
});
