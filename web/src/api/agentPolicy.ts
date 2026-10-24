import { ModelProviderEntry } from '../types';

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
  const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/policy`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new Error(`HTTP ${response.status}: Failed to parse server response`);
  }

  if (!response.ok) {
    const errorMsg =
      data?.error || data?.message || `HTTP ${response.status}: Failed to update agent policy`;
    throw new Error(errorMsg);
  }

  if (
    !data ||
    data.status !== 'ok' ||
    !data.agent ||
    !Array.isArray(data.agent.models) ||
    typeof data.agent.routing_strategy !== 'string'
  ) {
    throw new Error('Invalid server response: missing required policy fields');
  }

  return data as UpdatePolicyResponse;
}
