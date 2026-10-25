/**
 * Focused regression tests for the shouldInitializeDraft production predicate.
 *
 * The predicate lives in useDraftQueries.ts and is the single gatekeeper for
 * whether EditorView's bootstrap effect may fire a saveDraft call.
 * These tests exercise every branch of the allow/reject decision:
 *
 *  ALLOW : EditorApiError with status 404 + isDirty=false
 *  REJECT: EditorApiError 401, 403, 500 (auth/server errors)
 *  REJECT: plain Error (network/offline — no .status)
 *  REJECT: null  (no error at all)
 *  REJECT: any status when isDirty=true
 */
import { describe, it, expect } from 'bun:test';
import { EditorApiError } from '../editorApi';
import { shouldInitializeDraft } from './useDraftQueries';

// ---------------------------------------------------------------------------
// Helper — produce a typed EditorApiError
// ---------------------------------------------------------------------------
function apiErr(status: number) {
  return new EditorApiError(status, `http ${status}`);
}

// ---------------------------------------------------------------------------
// ALLOW cases
// ---------------------------------------------------------------------------

describe('shouldInitializeDraft — ALLOW', () => {
  it('returns true for 404 + not dirty', () => {
    expect(shouldInitializeDraft(apiErr(404), false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// REJECT — non-404 HTTP statuses
// ---------------------------------------------------------------------------

describe('shouldInitializeDraft — REJECT non-404 HTTP', () => {
  it('rejects 401 (unauthorized)', () => {
    expect(shouldInitializeDraft(apiErr(401), false)).toBe(false);
  });

  it('rejects 403 (forbidden)', () => {
    expect(shouldInitializeDraft(apiErr(403), false)).toBe(false);
  });

  it('rejects 500 (server error)', () => {
    expect(shouldInitializeDraft(apiErr(500), false)).toBe(false);
  });

  it('rejects 503 (service unavailable)', () => {
    expect(shouldInitializeDraft(apiErr(503), false)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// REJECT — network / plain Error (no .status)
// ---------------------------------------------------------------------------

describe('shouldInitializeDraft — REJECT network/plain Error', () => {
  it('rejects plain Error (network offline)', () => {
    expect(shouldInitializeDraft(new Error('Failed to fetch'), false)).toBe(false);
  });

  it('rejects TypeError (network failure variant)', () => {
    expect(shouldInitializeDraft(new TypeError('network error'), false)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// REJECT — null error (no error present)
// ---------------------------------------------------------------------------

describe('shouldInitializeDraft — REJECT null', () => {
  it('rejects null (no error)', () => {
    expect(shouldInitializeDraft(null, false)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// REJECT — isDirty=true blocks even a real 404
// ---------------------------------------------------------------------------

describe('shouldInitializeDraft — REJECT dirty editor', () => {
  it('rejects 404 when isDirty=true', () => {
    expect(shouldInitializeDraft(apiErr(404), true)).toBe(false);
  });

  it('rejects 401 when isDirty=true', () => {
    expect(shouldInitializeDraft(apiErr(401), true)).toBe(false);
  });

  it('rejects network Error when isDirty=true', () => {
    expect(shouldInitializeDraft(new Error('fetch failed'), true)).toBe(false);
  });

  it('rejects null when isDirty=true', () => {
    expect(shouldInitializeDraft(null, true)).toBe(false);
  });
});
