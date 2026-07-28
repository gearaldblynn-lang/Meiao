const SESSION_TOKEN_KEY = 'MEIAO_INTERNAL_SESSION_TOKEN';
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_MAX_ATTEMPTS = 360;

export type VoiceoverPreviewStatus = 'processing' | 'ready' | 'failed' | 'unknown';

export type VoiceoverPreview = {
  previewId: string;
  status: VoiceoverPreviewStatus;
  voiceName: string;
  targetLanguage: string;
  audioUrl?: string;
  message?: string;
};

type PreviewClientOptions = {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  pollIntervalMs?: number;
  maxAttempts?: number;
};

export class VoiceoverPreviewClientError extends Error {
  code: string;
  status: number;

  constructor(message: string, code = 'voiceover_preview_failed', status = 0) {
    super(message);
    this.name = 'VoiceoverPreviewClientError';
    this.code = code;
    this.status = status;
  }
}

const getSessionToken = () => {
  try {
    return localStorage.getItem(SESSION_TOKEN_KEY) || '';
  } catch {
    return '';
  }
};

const defaultSleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const onAbort = () => {
    globalThis.clearTimeout(timer);
    reject(new VoiceoverPreviewClientError('音色试听已取消', 'voiceover_preview_cancelled'));
  };
  const timer = globalThis.setTimeout(() => {
    signal?.removeEventListener('abort', onAbort);
    resolve();
  }, ms);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
});

const requestJson = async (
  url: string,
  init: RequestInit,
  { fetchImpl = fetch, signal }: PreviewClientOptions,
) => {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal });
  } catch (error) {
    if (signal?.aborted) {
      throw new VoiceoverPreviewClientError('音色试听已取消', 'voiceover_preview_cancelled');
    }
    throw new VoiceoverPreviewClientError(
      error instanceof Error ? error.message : '音色试听网络请求失败',
      'voiceover_preview_network_error',
    );
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new VoiceoverPreviewClientError(
      String(body?.message || '音色试听请求失败'),
      String(body?.code || 'voiceover_preview_failed'),
      response.status,
    );
  }
  const preview = body?.preview as VoiceoverPreview | undefined;
  if (!preview?.previewId || !preview?.status) {
    throw new VoiceoverPreviewClientError('音色试听响应无效', 'voiceover_preview_bad_response');
  }
  return preview;
};

export const requestVoiceoverPreview = (
  {
    targetLanguage,
    voiceName,
  }: {
    targetLanguage: string;
    voiceName: string;
  },
  options: PreviewClientOptions = {},
) => {
  const token = getSessionToken();
  return requestJson('/api/voiceover/voice-previews', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ targetLanguage, voiceName }),
  }, options);
};

export const waitForVoiceoverPreview = async (
  previewId: string,
  options: PreviewClientOptions = {},
) => {
  const token = getSessionToken();
  const sleep = options.sleep || defaultSleep;
  const pollIntervalMs = Number.isFinite(options.pollIntervalMs)
    ? Math.max(0, Number(options.pollIntervalMs))
    : DEFAULT_POLL_INTERVAL_MS;
  const maxAttempts = Number.isSafeInteger(options.maxAttempts)
    ? Math.max(1, Number(options.maxAttempts))
    : DEFAULT_MAX_ATTEMPTS;
  const url = `/api/voiceover/voice-previews/${encodeURIComponent(previewId)}`;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const preview = await requestJson(url, {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }, options);
    if (preview.status === 'ready') {
      if (!preview.audioUrl) {
        throw new VoiceoverPreviewClientError('试听音频地址缺失', 'voiceover_preview_bad_response');
      }
      return preview;
    }
    if (preview.status === 'failed' || preview.status === 'unknown') {
      throw new VoiceoverPreviewClientError(
        preview.message || '音色试听生成失败',
        'voiceover_preview_failed',
      );
    }
    if (attempt + 1 < maxAttempts) {
      await sleep(pollIntervalMs, options.signal);
    }
  }
  throw new VoiceoverPreviewClientError(
    '音色试听生成时间较长，请稍后再试',
    'voiceover_preview_timeout',
    408,
  );
};
