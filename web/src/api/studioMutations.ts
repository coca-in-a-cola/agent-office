/**
 * Shared production mutation option factories for ProcessStudio.
 *
 * Both factories are pure functions of (queryClient, callbacks) so they can
 * be used identically by the component (via useMutation) and by tests (via
 * MutationObserver) without duplication.
 *
 * Preflight epoch guard: the mutationFn checks the auth epoch BEFORE issuing
 * any network request. If the epoch captured at dispatch (authEpoch in vars)
 * no longer matches the current epoch the request is suppressed and
 * AuthSessionChangedError is thrown — the mutation settles as 'error' without
 * ever touching the network.
 *
 * Post-flight epoch guard: onSuccess / onError callbacks re-check the epoch
 * before writing to the query cache or calling UI callbacks, guarding against
 * the window between the request being sent and the response resolving.
 */

import type { QueryClient } from '@tanstack/react-query';
import { workflowApi, workflowKeys } from '../workflowApi';
import type { RunCommand } from '../workflowApi';
import type { RunDetail } from '../workflowTypes';
import { getAuthEpoch, AuthSessionChangedError } from './queryClient';

// ---------------------------------------------------------------------------
// Variable shapes (consumed by ProcessStudio and tests)
// ---------------------------------------------------------------------------

export type CommandVars = {
  runId: string;
  command: RunCommand;
  body?: Record<string, unknown>;
  authEpoch: number;
};

export type CreateVars = {
  goal: string;
  repo: string;
  definition_hash: string;
  authEpoch: number;
};

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

/**
 * Returns mutation options for issuing a workflow command against a live run.
 *
 * @param qc            The QueryClient instance (for cache writes / invalidation).
 * @param callbacks.onMutationError  Called with a human-readable error message when
 *                                   the mutation fails and the epoch is still current.
 */
export function commandMutationOptions(
  qc: QueryClient,
  callbacks?: {
    onMutationError?: (msg: string) => void;
  },
) {
  return {
    mutationFn: ({ runId, command, body, authEpoch }: CommandVars): Promise<RunDetail> => {
      // Preflight: reject without network if epoch is already stale at dispatch.
      if (getAuthEpoch() !== authEpoch) {
        return Promise.reject(new AuthSessionChangedError());
      }
      return workflowApi.command(runId, command, { actor: 'owner', ...body });
    },
    retry: false as const,
    onSuccess: (updatedDetail: RunDetail, { runId, authEpoch }: CommandVars) => {
      if (getAuthEpoch() !== authEpoch) return;
      qc.setQueryData(workflowKeys.run(runId), updatedDetail);
      void qc.invalidateQueries({ queryKey: workflowKeys.runs() });
    },
    onError: (_e: unknown, { command }: CommandVars) => {
      // AuthSessionChangedError means preflight rejected — no UI feedback needed.
      if (_e instanceof AuthSessionChangedError) return;
      if (callbacks?.onMutationError) {
        callbacks.onMutationError(`${command} failed`);
      }
    },
  };
}

/**
 * Returns mutation options for creating a new workflow run.
 *
 * @param qc             The QueryClient instance (for cache writes / invalidation).
 * @param callbacks.onSelectRunId  Called with the new run's ID when creation succeeds
 *                                  and the epoch is still current.
 */
export function createRunMutationOptions(
  qc: QueryClient,
  callbacks?: {
    onSelectRunId?: (id: string) => void;
  },
) {
  return {
    mutationFn: (input: CreateVars): Promise<RunDetail> => {
      // Preflight: reject without network if epoch is already stale at dispatch.
      if (getAuthEpoch() !== input.authEpoch) {
        return Promise.reject(new AuthSessionChangedError());
      }
      return workflowApi.createRun({
        goal: input.goal,
        repo: input.repo || undefined,
        definition_hash: input.definition_hash,
      });
    },
    retry: false as const,
    onSuccess: (created: RunDetail, { authEpoch }: CreateVars) => {
      if (getAuthEpoch() !== authEpoch) return;
      const newRunId = created.run.run_id;
      qc.setQueryData(workflowKeys.run(newRunId), created);
      void qc.invalidateQueries({ queryKey: workflowKeys.runs() });
      if (callbacks?.onSelectRunId) {
        callbacks.onSelectRunId(newRunId);
      }
    },
    onError: (_e: unknown) => {
      // Stale-epoch errors are silent — no UI callback.
      void _e;
    },
  };
}
