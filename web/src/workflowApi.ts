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
  }
}

const PREFIX = '/api/workflow';

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  try {
    return await transport<T>(path, { method, body, prefix: PREFIX });
  } catch (e) {
    if (e instanceof HttpError) {
      throw new WorkflowApiError(e.status, e.message);
    }
    throw e;
  }
}

const enc = encodeURIComponent;

export type RunCommand = 'pause' | 'resume' | 'cancel' | 'approve' | 'retry';

export const workflowApi = {
  listTemplates: async (): Promise<WorkflowTemplate[]> => {
    const raw = await request<(WorkflowTemplate & { definition_hash?: string; transitions?: any[] })[]>('GET', '/templates');
    return raw.map((t) => ({
      ...t,
      hash: t.hash || t.definition_hash || '',
      definition_hash: t.definition_hash || t.hash || '',
      node_count: t.node_count ?? (t.nodes ? t.nodes.length : 0),
      allowed_transitions: t.allowed_transitions ?? t.transitions ?? [],
    }));
  },
  listDefinitions: () =>
    request<{ definitions: DefinitionSummary[]; canonical_hash: string }>('GET', '/definitions'),
  getDefinition: (hash: string) =>
    request<WorkflowDefinition>('GET', `/definitions/${enc(hash)}`),
  listRuns: () =>
    request<{ runs: RunSummary[]; summary: Record<string, number> }>('GET', '/runs'),
  getRun: (runId: string) => request<RunDetail>('GET', `/runs/${enc(runId)}`),
  createRun: (body: { goal: string; repo?: string; definition_hash?: string; run_id?: string }) =>
    request<RunDetail>('POST', '/runs', body),
  command: (runId: string, command: RunCommand, body: Record<string, unknown> = {}) =>
    request<RunDetail>('POST', `/runs/${enc(runId)}/${command}`, body),
};
