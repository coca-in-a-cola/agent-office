// Editor API client — uses universal transport.
// ConflictError (409) and EditorApiError preserved for consumer compatibility.
import { transport, HttpError } from './api/transport';
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

async function request<T>(path: string, options: { method?: string; body?: string } = {}): Promise<T> {
  try {
    const body = options.body !== undefined ? JSON.parse(options.body) : undefined;
    return await transport<T>(path, { method: options.method || 'GET', body });
  } catch (e) {
    if (e instanceof HttpError) {
      const data = e.body as Record<string, unknown> | null;
      if (e.status === 409) {
        throw new ConflictError(
          (data?.message as string) || 'Draft revision conflict (optimistic concurrency)',
          (data?.current_revision as number) ?? 0,
          data?.expected_revision as number | undefined,
        );
      }
      throw new EditorApiError(
        e.status,
        e.message,
        data?.errors as string[] | undefined,
      );
    }
    throw e;
  }
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
