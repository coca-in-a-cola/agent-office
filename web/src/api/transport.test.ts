import { test, expect, beforeEach } from 'bun:test';
import { transport, HttpError } from './transport';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let fetchCalls: { url: string; init: RequestInit }[];

function mockFetch(response: Response | (() => Response)) {
  fetchCalls = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    fetchCalls.push({ url, init });
    return typeof response === 'function' ? response() : response;
  }) as any;
}

beforeEach(() => { fetchCalls = []; });

// ---------------------------------------------------------------------------
// JSON body + Content-Type
// ---------------------------------------------------------------------------

test('GET sends no Content-Type header', async () => {
  mockFetch(Response.json({ ok: true }));
  await transport('/api/state');
  const headers = fetchCalls[0].init.headers as Record<string, string>;
  expect(headers['Content-Type']).toBeUndefined();
});

test('POST with body sends Content-Type application/json', async () => {
  mockFetch(Response.json({ id: '1' }));
  await transport('/api/thing', { method: 'POST', body: { foo: 'bar' } });
  const headers = fetchCalls[0].init.headers as Record<string, string>;
  expect(headers['Content-Type']).toBe('application/json');
  expect(fetchCalls[0].init.body).toBe(JSON.stringify({ foo: 'bar' }));
});

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

test('always sends same-origin credentials', async () => {
  mockFetch(Response.json({}));
  await transport('/x');
  expect(fetchCalls[0].init.credentials).toBe('same-origin');
});

// ---------------------------------------------------------------------------
// Prefix
// ---------------------------------------------------------------------------

test('prefix is prepended to path', async () => {
  mockFetch(Response.json([]));
  await transport('/templates', { prefix: '/api/workflow' });
  expect(fetchCalls[0].url).toBe('/api/workflow/templates');
});

// ---------------------------------------------------------------------------
// 204 / empty body
// ---------------------------------------------------------------------------

test('204 No Content returns null', async () => {
  mockFetch(new Response(null, { status: 204 }));
  const result = await transport('/api/delete');
  expect(result).toBeNull();
});

test('empty body with 200 returns null', async () => {
  mockFetch(new Response('', { status: 200 }));
  const result = await transport('/api/empty');
  expect(result).toBeNull();
});

// ---------------------------------------------------------------------------
// Invalid JSON
// ---------------------------------------------------------------------------

test('non-JSON body on success returns null (no throw)', async () => {
  mockFetch(new Response('<html>proxy error</html>', {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  }));
  const result = await transport('/api/broken');
  expect(result).toBeNull();
});

// ---------------------------------------------------------------------------
// HTTP errors
// ---------------------------------------------------------------------------

test('HTTP 500 throws HttpError with message from JSON body', async () => {
  mockFetch(Response.json({ message: 'Internal failure' }, { status: 500 }));
  try {
    await transport('/api/fail');
    throw new Error('should have thrown');
  } catch (e) {
    expect(e).toBeInstanceOf(HttpError);
    const err = e as HttpError;
    expect(err.status).toBe(500);
    expect(err.message).toBe('Internal failure');
    expect(err.body).toEqual({ message: 'Internal failure' });
  }
});

test('HTTP 401 throws HttpError with generic message when no JSON', async () => {
  mockFetch(new Response('Unauthorized', { status: 401 }));
  try {
    await transport('/api/secret');
    throw new Error('should have thrown');
  } catch (e) {
    expect(e).toBeInstanceOf(HttpError);
    const err = e as HttpError;
    expect(err.status).toBe(401);
    expect(err.message).toBe('HTTP 401');
  }
});

test('HTTP 409 error preserves full body for domain mapping', async () => {
  const body = { message: 'Conflict', current_revision: 5, expected_revision: 3 };
  mockFetch(Response.json(body, { status: 409 }));
  try {
    await transport('/api/editor/drafts/x');
    throw new Error('should have thrown');
  } catch (e) {
    const err = e as HttpError;
    expect(err.status).toBe(409);
    expect(err.body).toEqual(body);
  }
});

// ---------------------------------------------------------------------------
// Timeout
// ---------------------------------------------------------------------------

test('request aborts after timeoutMs', async () => {
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    // Simulate a slow response
    await new Promise((resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      setTimeout(resolve, 5000);
    });
    return new Response('');
  }) as any;

  try {
    await transport('/api/slow', { timeoutMs: 50 });
    throw new Error('should have thrown');
  } catch (e) {
    expect((e as Error).name).toBe('AbortError');
  }
});

// ---------------------------------------------------------------------------
// Caller signal merging
// ---------------------------------------------------------------------------

test('caller abort signal cancels request', async () => {
  const controller = new AbortController();
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    await new Promise((resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      setTimeout(resolve, 5000);
    });
    return new Response('');
  }) as any;

  setTimeout(() => controller.abort(), 30);
  try {
    await transport('/api/slow', { signal: controller.signal, timeoutMs: 10_000 });
    throw new Error('should have thrown');
  } catch (e) {
    expect((e as Error).name).toBe('AbortError');
  }
});

// ---------------------------------------------------------------------------
// JSON auto-detect by content shape
// ---------------------------------------------------------------------------

test('parses JSON from text/plain when body starts with {', async () => {
  mockFetch(new Response('{"result": 42}', {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  }));
  const result = await transport<{ result: number }>('/api/json-ish');
  expect(result).toEqual({ result: 42 });
});
