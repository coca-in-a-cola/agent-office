/**
 * QueryClient singleton for Agent Office.
 *
 * Retry policy: no retry on 401/403 (auth — let the caller handle identity).
 * Mutations: no automatic retries.
 * Auth-identity transition: call `resetOnAuthChange()` to cancel in-flight
 * queries and clear the private cache so no prior-user data leaks.
 *
 * NOTE: WorkflowApiError (workflowApi.ts) wraps HttpError but is NOT an
 * instanceof HttpError. It exposes a `.status` number field. The helper
 * `extractStatus` handles both shapes so auth-abort applies uniformly.
 *
 * MUTATION EPOCH GUARD
 * `queryClient.clear()` removes mutations from the MutationCache data
 * structures but does NOT cancel already-executing `execute()` promises.
 * An in-flight mutation whose network request resolves after `clear()` will
 * still run its `onSuccess` callback, which would call `setQueryData` on the
 * freshly cleared (new-user) cache — a cross-identity data leak.
 *
 * Solution: a monotonic `authEpoch` counter is incremented on every identity
 * transition. Mutation `onSuccess` callbacks that write to the query cache
 * must capture the epoch at call-time (before `mutationFn` fires) and
 * compare it to the current epoch before calling `setQueryData`. If they
 * differ, the mutation belonged to the previous identity and must be ignored.
 *
 * Usage in mutation options:
 *   const epochAtDispatch = getAuthEpoch();
 *   onSuccess: (_data, vars) => {
 *     if (getAuthEpoch() !== epochAtDispatch) return; // stale identity
 *     qc.setQueryData(...);
 *   }
 *
 * `resetOnAuthChange` increments the epoch synchronously before calling
 * `clear()`, so any `onSuccess` that fires after the transition sees a
 * mismatched epoch and skips the cache write.
 */
import { QueryClient } from '@tanstack/react-query';

/**
 * Extract an HTTP status code from whatever shape of error our API layers
 * throw. Handles:
 *   • HttpError (instanceof — has .status)
 *   • WorkflowApiError (has .status but not instanceof HttpError)
 *   • Everything else → undefined (will be retried normally)
 */
function extractStatus(error: unknown): number | undefined {
  if (
    error !== null &&
    typeof error === 'object' &&
    'status' in error &&
    typeof (error as { status: unknown }).status === 'number'
  ) {
    return (error as { status: number }).status;
  }
  return undefined;
}

function shouldRetry(failureCount: number, error: unknown): boolean {
  const status = extractStatus(error);
  if (status === 401 || status === 403) return false;
  return failureCount < 3;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetry,
      // 30s stale — most dashboards poll anyway
      staleTime: 30_000,
    },
    mutations: {
      retry: false,
    },
  },
});

// ---------------------------------------------------------------------------
// Auth epoch — monotonic counter for cross-identity mutation guard
// ---------------------------------------------------------------------------

/** Monotonic counter; incremented on every auth identity transition. */
let _authEpoch = 0;

/**
 * Returns the current auth epoch. Mutation `onSuccess` callbacks that write
 * to the query cache must capture this value before the mutation fires and
 * compare at resolution time. A mismatch means the identity changed between
 * dispatch and settlement — the callback must not write to the new cache.
 */
export function getAuthEpoch(): number {
  return _authEpoch;
}

/**
 * Call on auth identity transitions (login, logout, user switch, role change).
 *
 * Order of operations is deliberate:
 *  1. Increment epoch first — any `onSuccess` that fires after this point
 *     sees a mismatched epoch and will skip `setQueryData`.
 *  2. Cancel in-flight queries (fire-and-forget; signals query AbortControllers).
 *  3. Clear both query and mutation caches — removes stored data and drops
 *     queued-but-not-yet-started mutations from the scope queue.
 *
 * NOTE: `clear()` removes mutations from the MutationCache data structures
 * but does NOT abort already-executing mutation promises. The epoch guard
 * (step 1) is the only defence against in-flight `onSuccess` callbacks
 * writing old-identity data into the new cache.
 */
export function resetOnAuthChange(): void {
  _authEpoch++;
  queryClient.cancelQueries();
  queryClient.clear();
}

// ---------------------------------------------------------------------------
// AuthSessionChangedError — thrown by mutation guards to signal stale identity
// ---------------------------------------------------------------------------

/**
 * Thrown by mutationFn when the auth epoch captured at dispatch time no longer
 * matches the current epoch. This means an auth transition fired while the
 * mutation was queued — the network request must not proceed because the caller
 * belongs to the previous identity.
 *
 * Internal metadata only — never returned in API DTO responses.
 */
export class AuthSessionChangedError extends Error {
  constructor() {
    super('Auth session changed — mutation belongs to a previous identity and was not sent.');
    this.name = 'AuthSessionChangedError';
  }
}

/** Exported for testing. */
export { extractStatus };
