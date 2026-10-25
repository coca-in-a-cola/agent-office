/**
 * TanStack Query mutation hooks for Process Studio editor write operations.
 *
 * Exposes four mutations:
 *  - bootstrapDraft: default-create a new draft (retry=false; only on confirmed 404).
 *  - saveDraft:      POST graph to server (retry=false; 409 surfaces as ConflictError).
 *  - validateGraph:  POST graph for server-side validation (retry=false).
 *  - publishGraph:   POST to publish immutable definition (retry=false; no auto-replay).
 *
 * Design rules:
 *  1. All mutations have retry: false — write operations must not auto-replay.
 *  2. Bootstrap dedup: a per-draftId promise registry (module-level Map) ensures
 *     exactly one POST per draftId per active attempt, even under React StrictMode's
 *     double-invoke. The second StrictMode effect observes the shared pending promise
 *     rather than cancelling it and firing a second request.
 *  3. Snapshot correctness: callers pass snapshot values (graph, revision) at call
 *     time. The hook stores nothing — it only calls the API and returns the result.
 *     Dirty-flag clearing and revision updating happen in the component's onSuccess
 *     callbacks using the snapshot taken before the mutation fired.
 *  4. 409 ConflictError propagates as-is; callers open the ConflictModal.
 *  5. Cache invalidation on publish: invalidates 'editor' drafts list and TQ's
 *     published-list/workflowDefinition keys so downstream queries refresh.
 *
 * All mutations are returned as stable useMutation results so components can
 * derive isPending / isError / mutateAsync from them directly.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';
import { editorApi, ConflictError } from '../editorApi';
import { editorKeys } from '../api/editorQueryKeys';
import type {
  EditorGraphDefinition,
  SaveDraftResponse,
  ValidateResponse,
  PublishResponse,
} from '../editorTypes';

// ---------------------------------------------------------------------------
// Bootstrap dedup registry
// ---------------------------------------------------------------------------
// Module-level so it survives React StrictMode's mount→cleanup→mount cycle.
// Map<draftId, Promise<SaveDraftResponse>> — second attempt observes the same
// pending promise instead of firing a duplicate POST.
const _bootstrapRegistry = new Map<string, Promise<SaveDraftResponse>>();

/** Exposed for testing only — do not call in production code. */
export function _clearBootstrapRegistry(): void {
  _bootstrapRegistry.clear();
}

/** Exposed for testing only — inspect pending entries. */
export function _bootstrapRegistryHas(draftId: string): boolean {
  return _bootstrapRegistry.has(draftId);
}

// ---------------------------------------------------------------------------
// bootstrapDraftOnce — production dedup function, exported for test reuse
// ---------------------------------------------------------------------------
// Exported so tests can exercise the real dedup logic without duplicating it.
// This is the exact function the hook's mutationFn delegates to.
export function bootstrapDraftOnce({ draftId, graph }: BootstrapDraftVars): Promise<SaveDraftResponse> {
  const existing = _bootstrapRegistry.get(draftId);
  if (existing) return existing;

  const promise = editorApi
    .saveDraft(draftId, graph /* no revision — initial create */)
    .finally(() => {
      if (_bootstrapRegistry.get(draftId) === promise) {
        _bootstrapRegistry.delete(draftId);
      }
    });

  _bootstrapRegistry.set(draftId, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// Variable types for each mutation
// ---------------------------------------------------------------------------

export interface BootstrapDraftVars {
  draftId: string;
  graph: EditorGraphDefinition;
}

export interface SaveDraftVars {
  draftId: string;
  graph: EditorGraphDefinition;
  /** Expected revision for optimistic concurrency. Omit for initial create. */
  revision?: number;
}

export interface ValidateGraphVars {
  graph: EditorGraphDefinition;
}

export interface PublishGraphVars {
  graph: EditorGraphDefinition;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseDraftMutationsResult {
  bootstrapMutation: UseMutationResult<SaveDraftResponse, Error, BootstrapDraftVars>;
  saveMutation: UseMutationResult<SaveDraftResponse, Error, SaveDraftVars>;
  validateMutation: UseMutationResult<ValidateResponse, Error, ValidateGraphVars>;
  publishMutation: UseMutationResult<PublishResponse, Error, PublishGraphVars>;
}

export function useDraftMutations(): UseDraftMutationsResult {
  const queryClient = useQueryClient();

  // -------------------------------------------------------------------------
  // Bootstrap: default-create a draft that returned 404
  // -------------------------------------------------------------------------
  // Dedup: coalesceles concurrent calls for the same draftId into one promise.
  // The shared promise is removed from the registry on settle so a future
  // re-mount (e.g. after a genuine draftId switch) can retry.
  const bootstrapMutation = useMutation<SaveDraftResponse, Error, BootstrapDraftVars>({
    retry: false,
    mutationFn: bootstrapDraftOnce,
    onSuccess: (_data, { draftId }) => {
      // Invalidate the draft cache so the next read reflects the new record.
      queryClient.invalidateQueries({ queryKey: editorKeys.draft(draftId) });
      queryClient.invalidateQueries({ queryKey: editorKeys.drafts() });
    },
  });

  // -------------------------------------------------------------------------
  // Save: POST graph with optimistic concurrency revision
  // -------------------------------------------------------------------------
  // Returns SaveDraftResponse; throws ConflictError on 409.
  // Does NOT clear isDirty — the component's onSuccess does so after verifying
  // the snapshot revision matches (prevents clearing dirty when a new edit
  // arrived after the save was dispatched).
  const saveMutation = useMutation<SaveDraftResponse, Error, SaveDraftVars>({
    retry: false,
    mutationFn: ({ draftId, graph, revision }: SaveDraftVars) =>
      editorApi.saveDraft(draftId, graph, revision),
    onSuccess: (_data, { draftId }) => {
      // Update the draft cache entry so reads reflect the saved state.
      queryClient.invalidateQueries({ queryKey: editorKeys.draft(draftId) });
    },
  });

  // -------------------------------------------------------------------------
  // Validate: POST graph for server-side contract/schema validation
  // -------------------------------------------------------------------------
  // Returns ValidateResponse with .valid and .errors[].
  // No cache interaction — validation is a read-only computation.
  const validateMutation = useMutation<ValidateResponse, Error, ValidateGraphVars>({
    retry: false,
    mutationFn: ({ graph }: ValidateGraphVars) => editorApi.validate(graph),
  });

  // -------------------------------------------------------------------------
  // Publish: POST to create an immutable workflow definition
  // -------------------------------------------------------------------------
  // retry=false — must not auto-replay a publish (idempotency not guaranteed).
  // Invalidates published-list and workflow definition caches on success.
  const publishMutation = useMutation<PublishResponse, Error, PublishGraphVars>({
    retry: false,
    mutationFn: ({ graph }: PublishGraphVars) => editorApi.publish({ graph }),
    onSuccess: () => {
      // Invalidate published list so the sidebar/observer refreshes.
      queryClient.invalidateQueries({ queryKey: ['editor', 'published'] });
      // Also invalidate the workflow definitions list used by ProcessStudio.
      queryClient.invalidateQueries({ queryKey: ['workflow', 'definitions'] });
    },
  });

  return {
    bootstrapMutation,
    saveMutation,
    validateMutation,
    publishMutation,
  };
}

// Re-export ConflictError so consumers can instanceof-check it without a
// separate editorApi import.
export { ConflictError };
