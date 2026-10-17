export interface Segment {
  id: number;
  position: number;
  source_text: string;
  target_text: string;
  revision: number;
}

export interface Project {
  id: number;
  title: string;
  instructions: string;
  source_language: string;
  target_language: string;
  segments: Segment[];
}

export interface SavedSegment {
  id: number;
  target_text: string;
  revision: number;
  saved_at: string;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = window.setTimeout(abort, 10_000);
  try {
    const response = await fetch(path, { ...init, cache: 'no-store', signal: controller.signal });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new ApiError(response.status, body?.detail?.message ?? 'Não foi possível concluir o pedido.');
    }
    return await response.json() as T;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export function getProject(signal?: AbortSignal) {
  return request<Project>('/api/projects/1', {}, signal);
}

export function saveSegment(projectId: number, segmentId: number, text: string, revision: number) {
  return request<SavedSegment>(`/api/projects/${projectId}/segments/${segmentId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_text: text, base_revision: revision }),
  });
}
