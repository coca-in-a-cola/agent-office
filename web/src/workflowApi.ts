// Thin fetch client for the Process Studio workflow API.
// Uses universal transport; WorkflowApiError preserved for consumer compatibility.
import { transport, HttpError } from './api/transport';
import {
  DefinitionSummary,
  RunDetail,
  RunSummary,
  WorkflowDefinition,
  WorkflowTemplate,
} from './workflowTypes';

export class WorkflowApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'WorkflowApiError';
  }
}

const PREFIX = '/api/workflow';

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  try {
    return await transport<T>(path, { method, body, prefix: PREFIX, signal });
  } catch (e) {
    if (e instanceof HttpError) {
      throw new WorkflowApiError(e.status, e.message);
    }
    throw e;
  }
}

const enc = encodeURIComponent;

export type RunCommand = 'pause' | 'resume' | 'cancel' | 'approve' | 'retry';

// ---------------------------------------------------------------------------
// Query key factories (stable arrays consumed by TanStack Query)
// ---------------------------------------------------------------------------

export const workflowKeys = {
  /** All workflow keys — pass to invalidateQueries for a full wipe. */
  all: ['workflow'] as const,
  /** Definitions list */
  definitions: () => ['workflow', 'definitions'] as const,
  /** Single immutable definition by hash */
  definition: (hash: string) => ['workflow', 'definition', hash] as const,
  /** Runs list */
  runs: () => ['workflow', 'runs'] as const,
  /** Single run detail by runId */
  run: (runId: string) => ['workflow', 'run', runId] as const,
} as const;

// ---------------------------------------------------------------------------
// API surface
// ---------------------------------------------------------------------------

export const workflowApi = {
  listTemplates: async (signal?: AbortSignal): Promise<WorkflowTemplate[]> => {
    const raw = await request<(WorkflowTemplate & { definition_hash?: string; transitions?: any[] })[]>(
      'GET', '/templates', undefined, signal,
    );
    return raw.map((t) => ({
      ...t,
      hash: t.hash || t.definition_hash || '',
      definition_hash: t.definition_hash || t.hash || '',
      node_count: t.node_count ?? (t.nodes ? t.nodes.length : 0),
      allowed_transitions: t.allowed_transitions ?? t.transitions ?? [],
    }));
  },
  listDefinitions: (signal?: AbortSignal) =>
    request<{ definitions: DefinitionSummary[]; canonical_hash: string }>('GET', '/definitions', undefined, signal),
  getDefinition: (hash: string, signal?: AbortSignal) =>
    request<WorkflowDefinition>('GET', `/definitions/${enc(hash)}`, undefined, signal),
  listRuns: (signal?: AbortSignal) =>
    request<{ runs: RunSummary[]; summary: Record<string, number> }>('GET', '/runs', undefined, signal),
  getRun: (runId: string, signal?: AbortSignal) =>
    request<RunDetail>('GET', `/runs/${enc(runId)}`, undefined, signal),
  createRun: (body: { goal: string; repo?: string; definition_hash?: string; run_id?: string }) =>
    request<RunDetail>('POST', '/runs', body),
  command: (runId: string, command: RunCommand, body: Record<string, unknown> = {}) =>
    request<RunDetail>('POST', `/runs/${enc(runId)}/${command}`, body),
};
