/**
 * Stable TanStack Query key factories for the Process Studio editor API.
 *
 * All keys are under the 'editor' namespace to avoid collisions with
 * 'workflow' keys. Each factory returns a readonly tuple so QueryClient
 * cache operations are exact-match safe.
 */

export const editorKeys = {
  /** Root scope — pass to invalidateQueries for a full editor cache wipe. */
  all: ['editor'] as const,

  /** List of all draft summaries. */
  drafts: () => ['editor', 'drafts'] as const,

  /** Single draft record by draftId. */
  draft: (draftId: string) => ['editor', 'draft', draftId] as const,
} as const;
