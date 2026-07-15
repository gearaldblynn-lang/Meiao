const SESSION_TOKEN_KEY = 'MEIAO_INTERNAL_SESSION_TOKEN';
const MEDIA_REQUEST_TIMEOUT_MS = 600_000;

export type MediaTranscodeKind = 'video' | 'audio';
export type MediaTranscodeProfile = 'seedance_reference' | 'subtitle_removal';
export type MediaUploadProgress = { loaded: number; total: number; ratio: number };

export type MediaTranscodeProbe = {
  sessionId: string;
  kind: MediaTranscodeKind;
  profile: MediaTranscodeProfile;
  fileName: string;
  durationSeconds: number;
  formatNames: string[];
  videoCodec?: string | null;
  pixelFormat?: string | null;
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
  profile: MediaTranscodeProfile;
  transcoded: boolean;
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

const uploadMediaFormData = <T>(
  url: string,
  formData: FormData,
  onUploadProgress: (progress: MediaUploadProgress) => void,
  callerSignal?: AbortSignal,
): Promise<T> => new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  const token = getSessionToken();
  let settled = false;
  const finish = (callback: (value: any) => void, value: unknown) => {
    if (settled) return;
    settled = true;
    callerSignal?.removeEventListener('abort', abort);
    callback(value);
  };
  const parseBody = () => {
    try {
      return JSON.parse(xhr.responseText || '{}');
    } catch {
      return {};
    }
  };
  const abort = () => xhr.abort();

  xhr.open('POST', url, true);
  xhr.timeout = MEDIA_REQUEST_TIMEOUT_MS;
  if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
  xhr.upload.onprogress = (event) => {
    const loaded = Math.max(0, Number(event.loaded || 0));
    const total = event.lengthComputable ? Math.max(0, Number(event.total || 0)) : 0;
    onUploadProgress({ loaded, total, ratio: total > 0 ? Math.min(1, loaded / total) : 0 });
  };
  xhr.onload = () => {
    const data = parseBody();
    if (xhr.status >= 200 && xhr.status < 300) {
      finish(resolve, data as T);
      return;
    }
    finish(reject, new MediaTranscodeClientError(
      String(data?.message || '媒体处理失败，请重试'),
      String(data?.code || 'media_transcode_failed'),
      xhr.status,
      Boolean(data?.retryable),
    ));
  };
  xhr.onerror = () => finish(reject, new MediaTranscodeClientError(
    '媒体处理网络请求失败',
    'media_network_error',
    0,
    true,
  ));
  xhr.ontimeout = () => finish(reject, new MediaTranscodeClientError(
    '媒体处理等待超时，请重试',
    'media_process_timeout',
    408,
    true,
  ));
  xhr.onabort = () => finish(reject, new MediaTranscodeClientError(
    '媒体处理已取消',
    'media_transcode_cancelled',
  ));

  if (callerSignal?.aborted) {
    finish(reject, new MediaTranscodeClientError(
      '媒体处理已取消',
      'media_transcode_cancelled',
    ));
    return;
  }
  callerSignal?.addEventListener('abort', abort, { once: true });
  xhr.send(formData);
});

export const createMediaTranscodeSession = async ({
  file,
  kind,
  profile = 'seedance_reference',
  onUploadProgress,
  signal,
}: {
  file: File;
  kind: MediaTranscodeKind;
  profile?: MediaTranscodeProfile;
  onUploadProgress?: (progress: MediaUploadProgress) => void;
  signal?: AbortSignal;
}): Promise<MediaTranscodeProbe> => {
  const formData = new FormData();
  formData.append('file', file, file.name || 'source');
  formData.append('kind', kind);
  formData.append('profile', profile);
  const data = onUploadProgress
    ? await uploadMediaFormData<MediaTranscodeProbe & { id?: string }>(
      '/api/media-transcodes/sessions',
      formData,
      onUploadProgress,
      signal,
    )
    : await requestMediaJson<MediaTranscodeProbe & { id?: string }>(
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
