/**
 * TanStack Query hooks for the legacy IsometricOffice campus grid.
 *
 * - useCampusGridQuery: fetches once on mount; never re-applies server data
 *   while the caller has a pending (unsaved) local edit.
 * - useCampusGridMutation: POST save via transport, returns status string.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CampusGrid } from '../grid/gridTypes';
import {
  campusGridKey,
  fetchCampusGridLegacy,
  saveCampusGridLegacy,
} from '../api/gridPersistence';
import { buildMutationOnSuccess } from './campusGridGuards';

/**
 * Fetch the campus grid from the server.
 * The `enabled` flag lets the caller suppress the query while there are
 * unsaved local changes (preventing a refetch from overwriting them).
 */
export function useCampusGridQuery(options?: { enabled?: boolean }) {
  return useQuery<CampusGrid | null>({
    queryKey: campusGridKey(),
    queryFn: async ({ signal }) => fetchCampusGridLegacy(signal),
    // Only apply server data if caller says it's safe to do so.
    enabled: options?.enabled !== false,
    // Grid layout rarely changes from outside — 60 s stale window is fine.
    staleTime: 60_000,
    // Null is a valid result (server has no grid yet); treat as success.
    throwOnError: false,
  });
}

export type SaveStatus = 'Saving...' | 'Saved!' | 'Error' | null;

/**
 * Mutation hook for persisting the campus grid.
 *
 * Returns `{ mutate, isPending }` plus the `QueryClient` so the caller can
 * `invalidateQueries` after a successful save if desired.
 */
export function useCampusGridMutation() {
  const qc = useQueryClient();

  const mutation = useMutation<boolean, Error, CampusGrid>({
    mutationFn: (grid: CampusGrid) => saveCampusGridLegacy(grid),
    onSuccess: buildMutationOnSuccess(qc),
  });

  return mutation;
}
