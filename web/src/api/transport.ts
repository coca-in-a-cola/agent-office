/**
 * Universal fetch transport for Agent Office.
 *
 * Every HTTP call in the app should go through `transport<T>()`.
 * Handles: JSON headers/body, empty responses, invalid JSON, cookie credentials,
 * timeout with AbortSignal merging, HTTP error extraction.
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: unknown = null,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface TransportOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Caller-provided abort signal; merged with internal timeout. */
  signal?: AbortSignal;
  /** Timeout in ms (default 10 000). */
  timeoutMs?: number;
  /** Base path prefix prepended to `path` (e.g. "/api/workflow"). */
  prefix?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mergeSignals(
  timeout: AbortSignal,
  caller?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  if (!caller) return { signal: timeout, cleanup: () => {} };

  // AbortSignal.any is widely available (Chrome 116+, FF 124+, Node 20+, Bun 1.x)
  if (typeof AbortSignal.any === 'function') {
    return { signal: AbortSignal.any([timeout, caller]), cleanup: () => {} };
  }

  // Fallback: manual controller
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  timeout.addEventListener('abort', onAbort);
  caller.addEventListener('abort', onAbort);
  const cleanup = () => {
    timeout.removeEventListener('abort', onAbort);
    caller.removeEventListener('abort', onAbort);
  };
  return { signal: controller.signal, cleanup };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Universal fetch transport.
 *
 * @returns Parsed JSON body typed as `T` (via assertion — no runtime validation).
 *          For 204 / empty body returns `null as unknown as T`.
 */
export async function transport<T>(
  path: string,
  opts: TransportOptions = {},
): Promise<T> {
  const {
    method = 'GET',
    body,
    headers: extraHeaders,
    signal: callerSignal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    prefix = '',
  } = opts;

  const url = `${prefix}${path}`;

  // --- Headers ---
  const headers: Record<string, string> = { ...extraHeaders };
  if (body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  // --- Timeout + signal merge ---
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  const { signal, cleanup } = mergeSignals(timeoutController.signal, callerSignal);

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      signal,
    });

    // --- Parse body ---
    let data: unknown = null;
    const ct = res.headers.get('content-type') || '';
    if (res.status !== 204) {
      const text = await res.text();
      if (text.length > 0) {
        if (ct.includes('application/json') || text.startsWith('{') || text.startsWith('[')) {
          try {
            data = JSON.parse(text);
          } catch {
            // non-JSON body (proxy error page etc.) — keep raw null
          }
        }
      }
    }

    // --- Error path ---
    if (!res.ok) {
      const message =
        data && typeof data === 'object' && data !== null && 'message' in data
          ? String((data as Record<string, unknown>).message)
          : `HTTP ${res.status}`;
      throw new HttpError(res.status, message, data);
    }

    return data as T;
  } finally {
    clearTimeout(timer);
    cleanup();
  }
}
