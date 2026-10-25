/**
 * Pure guard helpers for the IsometricOffice campus-grid lifecycle.
 *
 * These are extracted from the component so they can be unit-tested
 * deterministically without a React harness.
 *
 * Invariants they enforce:
 *  1. Server data NEVER overwrites local edits (dirty-gate).
 *  2. A save only clears the dirty flag when no newer local edit
 *     arrived while the request was in-flight (revision-equality guard).
 *  3. The mutation's onSuccess only updates the query cache for
 *     acknowledged (ok=true) saves — already handled in useCampusGridMutation;
 *     buildMutationOnSuccess is exported here so tests can exercise it
 *     against a real QueryClient without mounting a component.
 */

import type { QueryClient } from '@tanstack/react-query';
import type { CampusGrid } from '../grid/gridTypes';
import { campusGridKey } from '../api/gridPersistence';

// ---------------------------------------------------------------------------
// Guard 1: dirty-gate — should effect apply server data to local state?
// ---------------------------------------------------------------------------

/**
 * Returns true when the effect is allowed to apply new server data.
 *
 * Safe to apply only when:
 *  - There are no unsaved local edits (isDirty === false).
 *  - The incoming data is non-null.
 *
 * The query is already disabled while isDirty is true (enabled=!isDirty),
 * so in practice this guard is a belt-and-suspenders defence against
 * stale cache entries delivered before the flag flipped.
 */
export function shouldApplyServerGrid(
  isDirty: boolean,
  data: CampusGrid | null | undefined,
): data is CampusGrid {
  return !isDirty && data != null;
}

// ---------------------------------------------------------------------------
// Guard 2: revision-equality — should save completion clear the dirty flag?
// ---------------------------------------------------------------------------

/**
 * Returns true when the save response corresponds to the exact local
 * snapshot that was submitted — i.e., no newer edit arrived while the
 * request was in-flight.
 *
 * @param savedRevision  - revision counter captured at save-dispatch time.
 * @param currentRevision - revision counter value when the response lands.
 * @param ok             - whether the server acknowledged the save.
 */
export function shouldClearDirty(
  savedRevision: number,
  currentRevision: number,
  ok: boolean,
): boolean {
  return ok && savedRevision === currentRevision;
}

// ---------------------------------------------------------------------------
// Guard 3: mutation onSuccess — only update cache for acknowledged saves
// ---------------------------------------------------------------------------

/**
 * The onSuccess handler factory used by useCampusGridMutation.
 * Exported here so tests can exercise it against a real QueryClient.
 *
 * @param qc  - TanStack QueryClient instance.
 * @returns   - an onSuccess callback compatible with useMutation options.
 */
export function buildMutationOnSuccess(
  qc: QueryClient,
): (ok: boolean, grid: CampusGrid) => void {
  return (ok: boolean, grid: CampusGrid) => {
    if (ok) {
      qc.setQueryData<CampusGrid | null>(campusGridKey(), grid);
    }
  };
}
