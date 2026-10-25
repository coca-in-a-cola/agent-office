/**
 * QueryClient singleton for Agent Office.
 *
 * Retry policy: no retry on 401/403 (auth — let the caller handle identity).
 * Mutations: no automatic retries.
 * Auth-identity transition: call `resetOnAuthChange()` to cancel in-flight
 * queries and clear the private cache so no prior-user data leaks.
 */
import { QueryClient } from '@tanstack/react-query';
import { HttpError } from './transport';

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
    return false;
  }
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

/**
 * Call on auth identity transitions (login, logout, user switch).
 * Cancels all in-flight queries and wipes the private cache.
 */
export function resetOnAuthChange(): void {
  queryClient.cancelQueries();
  queryClient.clear();
}
