import { getMaxListeners, setMaxListeners } from 'node:events';

const DEFAULT_PROVIDER_BODY_TIMEOUT_MS = 60_000;

const createProviderBodyReadError = (code, message, extras = null) => {
  const error = new Error(message);
  error.code = code;
  error.providerMessage = message;
  if (extras && typeof extras === 'object') {
    Object.assign(error, extras);
  }
  return error;
};

export const allowConcurrentAbortListeners = (signal, count) => {
  if (!signal || typeof signal !== 'object') return;
  const currentLimit = Number(getMaxListeners(signal) || 10);
  const requestedLimit = Math.max(10, Number(count || 0) + 4);
  if (requestedLimit <= currentLimit) return;
  setMaxListeners(Math.max(currentLimit, requestedLimit), signal);
};

const readProviderBodyChunkWithTimeout = async (readOperation, {
  signal,
  timeoutMessage,
  timeoutMs = DEFAULT_PROVIDER_BODY_TIMEOUT_MS,
  providerStage = 'asset_download',
  onTimeout = null,
}) => {
  let timedOut = false;
  let timeoutId = null;
  let onAbort = null;
  const abortPromise = new Promise((_, reject) => {
    onAbort = () => {
      onTimeout?.();
      reject(createProviderBodyReadError('request_cancelled', '任务已取消'));
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
  });
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      reject(createProviderBodyReadError('provider_timeout', timeoutMessage, {
        providerStage,
        providerStatus: 'timeout',
      }));
      onTimeout?.();
    }, timeoutMs);
  });

  try {
    return await Promise.race([readOperation(), timeoutPromise, abortPromise]);
  } catch (error) {
    if (signal?.aborted) {
      throw createProviderBodyReadError('request_cancelled', '任务已取消');
    }
    if (timedOut || error?.code === 'provider_timeout') {
      throw createProviderBodyReadError('provider_timeout', timeoutMessage, {
        providerStage,
        providerStatus: 'timeout',
      });
    }
    if (error?.code) throw error;
    throw createProviderBodyReadError('provider_network_error', error?.message || `${timeoutMessage.replace(/超时$/, '')}失败`, {
      providerStage,
      providerStatus: 'network_error',
    });
  } finally {
    clearTimeout(timeoutId);
    if (signal && onAbort) signal.removeEventListener?.('abort', onAbort);
  }
};

export const readResponseBodyWithTimeout = async (response, {
  signal,
  timeoutMessage = '素材下载超时',
  timeoutMs = DEFAULT_PROVIDER_BODY_TIMEOUT_MS,
  providerStage = 'asset_download',
} = {}) => {
  if (!response.body?.getReader) {
    const arrayBuffer = await readProviderBodyChunkWithTimeout(
      () => response.arrayBuffer(),
      {
        signal,
        timeoutMessage,
        timeoutMs,
        providerStage,
        onTimeout: () => response.body?.cancel?.().catch?.(() => null),
      }
    );
    return Buffer.from(arrayBuffer);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await readProviderBodyChunkWithTimeout(
      () => reader.read(),
      {
        signal,
        timeoutMessage,
        timeoutMs,
        providerStage,
        onTimeout: () => reader.cancel().catch(() => null),
      }
    );
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.length;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
};
