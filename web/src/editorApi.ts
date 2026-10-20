import {
  DraftRecord,
  DraftSummary,
  EditorGraphDefinition,
  PublishResponse,
  SaveDraftResponse,
  ValidateResponse,
} from './editorTypes';

export class ConflictError extends Error {
  currentRevision: number;
  expectedRevision?: number;

  constructor(message: string, currentRevision: number, expectedRevision?: number) {
    super(message);
    this.name = 'ConflictError';
    this.currentRevision = currentRevision;
    this.expectedRevision = expectedRevision;
  }
}

export class EditorApiError extends Error {
  status: number;
  errors?: string[];

  constructor(status: number, message: string, errors?: string[]) {
    super(message);
    this.name = 'EditorApiError';
    this.status = status;
    this.errors = errors;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 409) {
      throw new ConflictError(
        data.message || 'Draft revision conflict (optimistic concurrency)',
        data.current_revision ?? 0,
        data.expected_revision
      );
    }
    throw new EditorApiError(res.status, data.message || `HTTP ${res.status}`, data.errors);
  }

  return data as T;
}

export const editorApi = {
  async listDrafts(): Promise<{ drafts: DraftSummary[] }> {
    return request<{ drafts: DraftSummary[] }>('/api/editor/drafts');
  },

  async getDraft(draftId: string): Promise<DraftRecord> {
    return request<DraftRecord>(`/api/editor/drafts/${encodeURIComponent(draftId)}`);
  },

  async saveDraft(
    draftId: string,
    graph: EditorGraphDefinition,
    revision?: number
  ): Promise<SaveDraftResponse> {
    return request<SaveDraftResponse>(`/api/editor/drafts/${encodeURIComponent(draftId)}`, {
      method: 'POST',
      body: JSON.stringify({ graph, revision }),
    });
  },

  async validate(graph: EditorGraphDefinition): Promise<ValidateResponse> {
    return request<ValidateResponse>('/api/editor/validate', {
      method: 'POST',
      body: JSON.stringify({ graph }),
    });
  },

  async publish(payload: { graph?: EditorGraphDefinition; draft_id?: string }): Promise<PublishResponse> {
    return request<PublishResponse>('/api/editor/publish', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async listPublished(): Promise<{ published: any[] }> {
    return request<{ published: any[] }>('/api/editor/published');
  },

  async getPublished(graphId: string, version?: number): Promise<any> {
    const q = version !== undefined ? `?version=${encodeURIComponent(version)}` : '';
    return request<any>(`/api/editor/published/${encodeURIComponent(graphId)}${q}`);
  },
};
