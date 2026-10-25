/**
 * TanStack Query hooks for the PixiOfficeCanvas furniture grid V2.
 *
 * useGridV2Query  — fetches the campus grid; lifecycle independent of Pixi
 *                   init/teardown so WebGL restarts never re-fetch.
 * useGridV2Mutation — serialized write hook that:
 *   - Sets retry: false (saves must not auto-replay).
 *   - Uses a mutation scope so writes queue and execute one-at-a-time; the
 *     last-queued snapshot wins on the server.
 *   - Throws on save failure so callers can surface the error; never updates
 *     cache on false-success.
 *   - Returns a stable mutateRef so imperative Pixi tap callbacks hold the
 *     same function reference across re-renders without reinitialising WebGL.
 *
 * Design rules:
 *  1. Query is fetched once; staleTime=Infinity means re-renders don't
 *     trigger refetches. Callers must NOT apply server data after any local
 *     edit has been made (guard: applyServerDataRef).
 *  2. Mutation scope id 'campusGrid-v2' serializes execution via TanStack's
 *     internal queue. Variable snapshots are captured at call-time so the
 *     last call's grid is what the server receives, regardless of order.
 *  3. saveCampusGridV2 throws on transport error or a false-save response,
 *     making isError / error reliably reflect reality.
 *  4. mutateRef is updated synchronously after every render so Pixi tap
 *     callbacks always call the latest version without stale closure.
 *  5. furnitureGridMutationOptions(qc) accepts a QueryClient and installs an
 *     onSuccess that writes the acknowledged snapshot into the query cache.
 *     On remount the query (staleTime=Infinity) serves this cached snapshot
 *     rather than re-fetching, so the user sees their last saved layout
 *     immediately. onSuccess only runs when saveCampusGridV2 resolves (void);
 *     failed saves never touch the cache, so the prior acknowledged snapshot
 *     is preserved. Cache is updated with vars.grid (the exact grid sent to
 *     the server), not a server response body, which is void.
 *  6. Auth-epoch guard: epoch is captured at dispatch time (inside mutate
 *     wrapper), included in mutation variables, checked in mutationFn
 *     (pre-flight, blocks the POST) and onSuccess (settlement, blocks cache
 *     write). This covers both queued-write network risk and in-flight
 *     response contamination. See queryClient.ts for the epoch/clear design.
 */

import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';
import { useRef, useCallback } from 'react';
import { fetchCampusGridV2, saveCampusGridV2, type CampusGridV2 } from '../api/gridPersistence';
import { gridV2Keys } from '../api/gridQueryKeys';
import { getAuthEpoch, AuthSessionChangedError } from '../api/queryClient';

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export interface UseGridV2QueryResult {
  /** Server grid data; null if not yet loaded or absent. */
  data: CampusGridV2 | null | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

/**
 * Fetches the campus grid V2. staleTime=Infinity: the query is fetched once
 * per mount (or explicit invalidation) and never in background, so Pixi
 * re-renders and WebGL teardown+restore cycles do not trigger extra network
 * requests.
 *
 * The queryFn forwards the TanStack AbortSignal to the transport so in-flight
 * requests are cancelled on unmount.
 */
export function useGridV2Query(): UseGridV2QueryResult {
  const { data, isLoading, isError, error } = useQuery<CampusGridV2 | null>({
    queryKey: gridV2Keys.grid(),
    queryFn: ({ signal }) => fetchCampusGridV2(signal),
    // Once loaded, never refetch in the background — furniture edits are
    // local-first and only synced via mutation.
    staleTime: Infinity,
    // Don't hammer the server on network hiccups; retry policy from
    // QueryClient handles 4xx/5xx auth gating already.
    retry: false,
    // Don't refetch on window focus — the canvas doesn't need a stale guard.
    refetchOnWindowFocus: false,
  });

  return { data, isLoading, isError, error };
}

// ---------------------------------------------------------------------------
// Mutation
// ---------------------------------------------------------------------------

/**
 * Variables type for the furniture grid mutation.
 *
 * authEpoch is captured at the moment the caller dispatches the mutation
 * (i.e. inside the public `mutate(grid)` wrapper in useGridV2Mutation),
 * NOT at options-factory / hook-render time. This is the critical invariant:
 * the epoch must reflect the identity at the moment the user action fires,
 * not the identity at the previous render cycle.
 */
export interface FurnitureGridMutationVars {
  grid: CampusGridV2;
  /** Auth epoch captured at dispatch time — compared in mutationFn and onSuccess. */
  authEpoch: number;
}

/**
 * Shared mutation options for campus grid V2.
 *
 * Exported so tests can exercise the same options the hook uses — no duplication.
 *
 * EPOCH GUARD (per-variables, not per-factory-call):
 *  The options factory does NOT capture epoch at call time. Instead, epoch is
 *  part of the mutation variables (`vars.authEpoch`), captured by the public
 *  `mutate(grid)` wrapper at the exact moment of dispatch. This eliminates the
 *  render-stale window: the epoch in variables always matches the identity at
 *  which the user action fired.
 *
 *  mutationFn checks vars.authEpoch BEFORE making any network request.
 *  If the epoch already mismatches (auth transition fired between dispatch
 *  and queue execution), the function throws AuthSessionChangedError and the
 *  POST is never sent. This covers queued mutations de-queued after an auth
 *  reset.
 *
 *  NOTE: once mutationFn has passed the pre-flight check and sent the request,
 *  an in-flight POST cannot be recalled even if auth transitions during the
 *  network round-trip. The onSuccess settlement guard below addresses the
 *  cache side-effect but cannot undo the server write.
 *
 *  onSuccess re-checks vars.authEpoch at settlement time.
 *  If it mismatches, the cache write is suppressed. This covers the case where
 *  the network response arrives after an auth transition that fired while the
 *  request was in-flight. The new-user cache is protected even though the
 *  server write may have landed.
 *
 * Cache update rules (unchanged from prior version):
 *  - onSuccess only fires when saveCampusGridV2 resolves (void), never on error.
 *  - The cache is updated with `vars.grid` (the exact snapshot sent to server).
 *  - staleTime=Infinity on the query means the cached snapshot serves as
 *    initial state on remount without a network round-trip.
 */
export function furnitureGridMutationOptions(qc: QueryClient) {
  return {
    mutationFn: async (vars: FurnitureGridMutationVars): Promise<void> => {
      // Pre-flight epoch guard: reject before network if auth already
      // transitioned since dispatch (queued-write protection).
      if (getAuthEpoch() !== vars.authEpoch) {
        throw new AuthSessionChangedError();
      }
      return saveCampusGridV2(vars.grid);
    },
    retry: false as const,
    scope: { id: 'campusGrid-v2' },
    onSuccess: (_data: void, vars: FurnitureGridMutationVars) => {
      // Settlement epoch guard: suppress cache write if identity changed
      // while this request was in-flight.
      if (getAuthEpoch() !== vars.authEpoch) return;
      qc.setQueryData<CampusGridV2 | null>(gridV2Keys.grid(), vars.grid);
    },
  };
}

export interface UseGridV2MutationResult {
  /** Call with the full grid snapshot to persist it. Throws on failure. */
  mutate: (grid: CampusGridV2) => void;
  /**
   * Stable ref whose .current always points to the latest mutate function.
   * Use this in Pixi imperative callbacks to avoid stale closures and prevent
   * WebGL re-initialization triggered by effect dependency changes.
   */
  mutateRef: React.MutableRefObject<(grid: CampusGridV2) => void>;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  /** Reset error state after the user acknowledges it. */
  reset: () => void;
  /** The underlying TanStack mutation result for advanced consumers. */
  mutation: UseMutationResult<void, Error, FurnitureGridMutationVars>;
}

/**
 * Serialized, error-surfacing mutation for campus grid V2 saves.
 *
 * Serialization: TanStack executes scope-keyed mutations one at a time, so
 * concurrent taps (delete+add in quick succession) queue up and the final
 * snapshot is what the server receives. No write overlap / snapshot reorder.
 *
 * Error visibility: saveCampusGridV2 throws on HTTP error or server-level
 * false-save, making isError reliable.
 *
 * Cache freshness: on acknowledged save, onSuccess writes the saved snapshot
 * into the query cache via setQueryData. On remount, the staleTime=Infinity
 * query serves this cached snapshot as initial state so the user sees their
 * last saved layout without a network round-trip. Failed saves do not touch
 * the cache (onSuccess never fires on error), so the prior acknowledged
 * snapshot is preserved.
 *
 * Auth-epoch guard: the public `mutate(grid)` wrapper captures `getAuthEpoch()`
 * at the moment of invocation and passes it as `vars.authEpoch`. The
 * mutationFn rejects before POSTing if auth has transitioned since dispatch
 * (queued-write protection). onSuccess re-checks at settlement time to prevent
 * cache contamination from in-flight responses that arrived after an auth reset.
 *
 * Local-edit guard: the Pixi component sets serverDataAppliedRef.current=true
 * at placement/delete time (before the mutation is fired). The component's
 * useEffect only applies server data while that ref is false. On remount the
 * component mounts fresh with ref=false, so the newly cached snapshot is applied
 * once, then guarded. setQueryData does NOT trigger the effect on an already-
 * mounted component because the query observer won't re-deliver data that was
 * set synchronously during an active session — only on remount when the query
 * result is read fresh.
 */
export function useGridV2Mutation(): UseGridV2MutationResult {
  const qc = useQueryClient();
  const mutation = useMutation<void, Error, FurnitureGridMutationVars>({
    ...furnitureGridMutationOptions(qc),
  });

  // Wrap mutate into a stable callback that captures authEpoch at call-time
  // (dispatch time), NOT at render time. This is the invariant: epoch must
  // reflect the identity at the moment the user action fires.
  const mutate = useCallback(
    (grid: CampusGridV2) => {
      mutation.mutate({ grid, authEpoch: getAuthEpoch() });
    },
    [mutation],
  );

  // Stable ref: updated every render so Pixi tap callbacks never hold a stale
  // closure. Updating a ref is synchronous and does not cause re-renders.
  const mutateRef = useRef<(grid: CampusGridV2) => void>(mutate);
  mutateRef.current = mutate;

  return {
    mutate,
    mutateRef,
    isPending: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
    reset: mutation.reset,
    mutation,
  };
}
