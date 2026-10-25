/**
 * TanStack Query hook for /api/state polling.
 *
 * Preserves existing UI/auth semantics:
 * - polls every 2500ms when enabled (authUser present)
 * - clears authUser on 401
 * - exposes isLive / lastSync / error
 */
import { useQuery } from '@tanstack/react-query';
import { transport, HttpError } from '../api/transport';
import { OfficeState } from '../types';

export const OFFICE_STATE_KEY = ['officeState'] as const;
const POLL_INTERVAL = 2500;

interface UseOfficeStateOptions {
  enabled: boolean;
  onAuthExpired: () => void;
}

export function useOfficeState({ enabled, onAuthExpired }: UseOfficeStateOptions) {
  const query = useQuery<OfficeState>({
    queryKey: OFFICE_STATE_KEY,
    queryFn: async ({ signal }) => {
      try {
        return await transport<OfficeState>('/api/state', { signal });
      } catch (e) {
        if (e instanceof HttpError && e.status === 401) {
          onAuthExpired();
        }
        throw e;
      }
    },
    enabled,
    refetchInterval: enabled ? POLL_INTERVAL : false,
    // Don't retry auth errors (handled by queryClient defaults too)
    retry: (count, error) => {
      if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
        return false;
      }
      return count < 3;
    },
  });

  return {
    state: query.data ?? null,
    isLive: query.isSuccess,
    lastSync: query.dataUpdatedAt ? new Date(query.dataUpdatedAt) : null,
    error: query.error,
    isFetching: query.isFetching,
  };
}
