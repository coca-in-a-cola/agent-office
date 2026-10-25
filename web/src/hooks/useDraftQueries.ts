/**
 * TanStack Query hooks for Process Studio editor draft list/load.
 *
 * Design notes:
 *  - useListDrafts: fetches all draft summaries. No background refetch
 *    while the editor has unsaved changes (enabled=!isDirty) to avoid
 *    stomping UI with stale cache flicker. staleTime=0 so the list is
 *    always fresh on first mount.
 *  - useGetDraft: loads a single draft record by draftId. Also gated by
 *    isDirty — if the user has local edits in flight we do not re-fetch
 *    (background refetch would never apply to local state anyway, but
 *    disabling keeps the cache from being invalidated mid-edit).
 *    staleTime=Infinity: once loaded, a draft is only re-fetched on an
 *    explicit refetch() call (e.g. handleReloadDraft).
 *  - Both hooks forward the QueryFn's AbortSignal to the transport layer.
 *  - Neither hook retries on 401/403 — inherits from QueryClient defaults.
 *
 * Caller responsibilities:
 *  - Pass isDirty so queries are suspended while local edits are in-flight.
 *  - Call getDraftQuery.refetch() when reloading after a conflict (409).
 *  - Initial-draft auto-save (when the server returns 404) remains in the
 *    component via useMutation; these hooks only handle the read side.
 *  - Inspect error.status to distinguish 404 (create-if-missing) from
 *    401/403/500/network (do NOT write on those).
 */
import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { editorApi, EditorApiError } from '../editorApi';
import { editorKeys } from '../api/editorQueryKeys';
import type { DraftRecord, DraftSummary } from '../editorTypes';

// ---------------------------------------------------------------------------
// useListDrafts
// ---------------------------------------------------------------------------

export interface UseListDraftsResult {
  drafts: DraftSummary[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

/**
 * Fetches the list of all draft summaries.
 *
 * @param isDirty - When true, disables background refetch to preserve
 *                  unsaved local changes.
 */
export function useListDrafts(isDirty: boolean): UseListDraftsResult {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: editorKeys.drafts(),
    queryFn: async ({ signal }) => editorApi.listDrafts(signal),
    // Never refetch while the user has unsaved local edits.
    enabled: !isDirty,
    // Always re-fetch on mount so the list is fresh (sidebar may update
    // as other drafts are created elsewhere).
    staleTime: 0,
    // No background interval — draft lists don't need to poll.
    refetchOnWindowFocus: false,
  });

  return {
    drafts: data?.drafts ?? [],
    isLoading,
    isError,
    error,
  };
}

// ---------------------------------------------------------------------------
// shouldInitializeDraft — production predicate for the bootstrap guard
// ---------------------------------------------------------------------------

/**
 * Returns true ONLY when the error represents a confirmed 404 (draft does not
 * exist yet) AND the user has no unsaved local edits.
 *
 * Deliberately rejects:
 *  - Network errors (plain Error, no .status) — server may be reachable later;
 *    writing now risks silent data loss if the server already has the draft.
 *  - 401 / 403 / 500 and any other non-404 EditorApiError status — auth or
 *    server problems; writing would be unsafe.
 *  - null error with isDraftLoadError=false — no error, nothing to initialize.
 *  - isDirty=true — local edits exist; must not overwrite.
 *
 * @param error  - The error value from useGetDraft (EditorApiError | Error | null).
 * @param isDirty - Whether the editor has unsaved local changes.
 */
export function shouldInitializeDraft(
  error: EditorApiError | Error | null,
  isDirty: boolean,
): boolean {
  if (isDirty) return false;
  if (!(error instanceof EditorApiError)) return false; // network Error or null → reject
  return error.status === 404;
}

// ---------------------------------------------------------------------------
// useGetDraft
// ---------------------------------------------------------------------------

export interface UseGetDraftResult {
  draftRecord: DraftRecord | undefined;
  isLoading: boolean;
  isError: boolean;
  /** Typed error — EditorApiError carries .status for 404/401/403/500 discrimination.
   *  Network failures are plain Error objects. Null when no error. */
  error: EditorApiError | Error | null;
  /** Full TanStack refetch signature — callers may await the returned
   *  QueryObserverResult (e.g. handleReloadDraft reads result.data directly). */
  refetch: UseQueryResult<DraftRecord, Error>['refetch'];
}

/**
 * Loads a single draft record by draftId.
 *
 * staleTime=Infinity: once the draft is loaded into cache it is treated
 * as authoritative until an explicit refetch() is triggered (e.g. after
 * a 409 conflict resolution or a user-initiated reload).
 *
 * @param draftId - ID of the draft to load.
 * @param isDirty - When true, disables background re-fetch.
 */
export function useGetDraft(draftId: string, isDirty: boolean): UseGetDraftResult {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: editorKeys.draft(draftId),
    queryFn: async ({ signal }) => editorApi.getDraft(draftId, signal),
    // Never re-fetch while unsaved changes exist.
    enabled: !isDirty,
    // Treat a loaded draft as indefinitely fresh — only reload on demand.
    staleTime: Infinity,
    // Don't clobber local edits on window focus.
    refetchOnWindowFocus: false,
  });

  return {
    draftRecord: data,
    isLoading,
    isError,
    error: error instanceof EditorApiError ? error : error instanceof Error ? error : null,
    refetch,
  };
}
