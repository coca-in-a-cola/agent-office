import { ModelProviderEntry } from '../types';
import { transport, HttpError } from './transport';

export interface UpdatePolicyPayload {
  models: ModelProviderEntry[];
  routing_strategy: 'priority' | 'round_robin';
}

export interface UpdatePolicyResponse {
  status: 'ok';
  agent: {
    models: ModelProviderEntry[];
    routing_strategy: 'priority' | 'round_robin';
    [key: string]: unknown;
  };
}

export async function updateAgentPolicy(
  agentId: string,
  payload: UpdatePolicyPayload
): Promise<UpdatePolicyResponse> {
  let data: unknown;
  try {
    data = await transport<unknown>(`/api/agents/${encodeURIComponent(agentId)}/policy`, {
      method: 'POST',
      body: { models: payload.models, strategy: payload.routing_strategy },
    });
  } catch (err) {
    if (err instanceof HttpError) {
      const body = err.body as Record<string, unknown> | null;
      const errorMsg =
        (body?.error as string) ||
        (body?.message as string) ||
        `HTTP ${err.status}: Failed to update agent policy`;
      throw new Error(errorMsg);
    }
    throw new Error(`HTTP error: Failed to parse server response`);
  }

  if (
    !data ||
    (data as any).status !== 'ok' ||
    !(data as any).agent ||
    !Array.isArray((data as any).agent.models) ||
    typeof (data as any).agent.routing_strategy !== 'string'
  ) {
    throw new Error('Invalid server response: missing required policy fields');
  }

  return data as UpdatePolicyResponse;
}
