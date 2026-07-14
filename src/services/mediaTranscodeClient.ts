const SESSION_TOKEN_KEY = 'MEIAO_INTERNAL_SESSION_TOKEN';
const MEDIA_REQUEST_TIMEOUT_MS = 600_000;

export type MediaTranscodeKind = 'video' | 'audio';

export type MediaTranscodeProbe = {
  sessionId: string;
  kind: MediaTranscodeKind;
  fileName: string;
  durationSeconds: number;
  formatNames: string[];
  videoCodec?: string | null;
  audioCodec?: string | null;
  width?: number | null;
  height?: number | null;
  frameRate?: number | null;
  sizeBytes: number;
  hasAudio?: boolean;
};

export type MediaTranscodeResult = {
  fileUrl: string;
  assetId?: string;
  kind: MediaTranscodeKind;
  fileName: string;
  mimeType: string;
  durationSeconds: number;
  width?: number | null;
  height?: number | null;
  frameRate?: number | null;
  sizeBytes: number;
};

export class MediaTranscodeClientError extends Error {
  code: string;
  status: number;
  retryable: boolean;

  constructor(message: string, code = 'media_transcode_failed', status = 0, retryable = false) {
    super(message);
    this.name = 'MediaTranscodeClientError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

const getSessionToken = () => {
  try {
    return localStorage.getItem(SESSION_TOKEN_KEY) || '';
  } catch {
    return '';
  }
};

const createRequestSignal = (callerSignal?: AbortSignal, timeoutMs = MEDIA_REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const abort = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abort();
  else callerSignal?.addEventListener('abort', abort, { once: true });
  const timeout = globalThis.setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      globalThis.clearTimeout(timeout);
      callerSignal?.removeEventListener('abort', abort);
    },
  };
};

const requestMediaJson = async <T>(
  url: string,
  init: RequestInit,
  callerSignal?: AbortSignal,
): Promise<T> => {
  const token = getSessionToken();
  const { signal, cleanup } = createRequestSignal(callerSignal);
  try {
    const response = await fetch(url, {
      ...init,
      signal,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new MediaTranscodeClientError(
        String(data?.message || '媒体处理失败，请重试'),
        String(data?.code || 'media_transcode_failed'),
        response.status,
        Boolean(data?.retryable),
      );
    }
    return data as T;
  } catch (error) {
    if (error instanceof MediaTranscodeClientError) throw error;
    if (callerSignal?.aborted) {
      throw new MediaTranscodeClientError('媒体处理已取消', 'media_transcode_cancelled');
    }
    if (signal.aborted) {
      throw new MediaTranscodeClientError('媒体处理等待超时，请重试', 'media_process_timeout', 408, true);
    }
    throw new MediaTranscodeClientError(
      error instanceof Error ? error.message : '媒体处理网络请求失败',
      'media_network_error',
      0,
      true,
    );
  } finally {
    cleanup();
  }
};

export const createMediaTranscodeSession = async ({
  file,
  kind,
  signal,
}: {
  file: File;
  kind: MediaTranscodeKind;
  signal?: AbortSignal;
}): Promise<MediaTranscodeProbe> => {
  const formData = new FormData();
  formData.append('file', file, file.name || 'source');
  formData.append('kind', kind);
  const data = await requestMediaJson<MediaTranscodeProbe & { id?: string }>(
    '/api/media-transcodes/sessions',
    { method: 'POST', body: formData },
    signal,
  );
  return { ...data, sessionId: data.sessionId || data.id || '' };
};

export const convertMediaTranscodeSession = ({
  sessionId,
  startSeconds,
  endSeconds,
  module = 'video',
  signal,
}: {
  sessionId: string;
  startSeconds: number;
  endSeconds: number;
  module?: string;
  signal?: AbortSignal;
}) => requestMediaJson<MediaTranscodeResult>(
  `/api/media-transcodes/sessions/${encodeURIComponent(sessionId)}/convert`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ startSeconds, endSeconds, module }),
  },
  signal,
);

export const cancelMediaTranscodeSession = ({
  sessionId,
  signal,
}: {
  sessionId: string;
  signal?: AbortSignal;
}) => requestMediaJson<{ cancelled: boolean }>(
  `/api/media-transcodes/sessions/${encodeURIComponent(sessionId)}`,
  { method: 'DELETE' },
  signal,
);
