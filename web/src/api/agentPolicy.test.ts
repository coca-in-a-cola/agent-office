import { describe, it, expect, afterEach } from 'bun:test';
import { updateAgentPolicy, type UpdatePolicyPayload } from './agentPolicy';

describe('updateAgentPolicy', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const payload: UpdatePolicyPayload = {
    models: [{ provider: 'anthropic', model: 'claude-sonnet-4-5', priority: 1 }],
    routing_strategy: 'priority',
  };

  const successBody = {
    status: 'ok',
    agent: {
      models: [{ provider: 'anthropic', model: 'claude-sonnet-4-5', priority: 1 }],
      routing_strategy: 'priority',
    },
  };

  it('sends POST with mapped strategy key and returns parsed response', async () => {
    let capturedBody: any;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return Response.json(successBody);
    }) as any;

    const result = await updateAgentPolicy('agent-001', payload);
    expect(result.status).toBe('ok');
    expect(result.agent.routing_strategy).toBe('priority');
    // maps routing_strategy → strategy on the wire
    expect(capturedBody.strategy).toBe('priority');
    expect(capturedBody.models).toEqual(payload.models);
    // routing_strategy key not sent
    expect(capturedBody.routing_strategy).toBeUndefined();
  });

  it('sends credentials: same-origin via transport', async () => {
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return Response.json(successBody);
    }) as any;

    await updateAgentPolicy('agent-001', payload);
    expect(capturedInit?.credentials).toBe('same-origin');
  });

  it('throws with server error message on HTTP 400 with error field', async () => {
    globalThis.fetch = (async () => {
      return Response.json({ error: 'agent not found' }, { status: 400 });
    }) as any;

    await expect(updateAgentPolicy('no-such-agent', payload)).rejects.toThrow('agent not found');
  });

  it('throws with message field when error absent', async () => {
    globalThis.fetch = (async () => {
      return Response.json({ message: 'Permission denied' }, { status: 403 });
    }) as any;

    await expect(updateAgentPolicy('agent-001', payload)).rejects.toThrow('Permission denied');
  });

  it('throws generic HTTP message when no error/message field', async () => {
    globalThis.fetch = (async () => {
      return Response.json({}, { status: 503 });
    }) as any;

    await expect(updateAgentPolicy('agent-001', payload)).rejects.toThrow(
      'HTTP 503: Failed to update agent policy'
    );
  });

  it('throws on invalid server response shape (missing status:ok)', async () => {
    globalThis.fetch = (async () => {
      return Response.json({ status: 'error', agent: null });
    }) as any;

    await expect(updateAgentPolicy('agent-001', payload)).rejects.toThrow(
      'Invalid server response'
    );
  });

  it('throws on invalid response shape (agent.models not array)', async () => {
    globalThis.fetch = (async () => {
      return Response.json({
        status: 'ok',
        agent: { models: 'not-an-array', routing_strategy: 'priority' },
      });
    }) as any;

    await expect(updateAgentPolicy('agent-001', payload)).rejects.toThrow(
      'Invalid server response'
    );
  });
});
