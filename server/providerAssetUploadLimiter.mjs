const DEFAULT_KIE_ASSET_UPLOAD_CONCURRENCY = 3;

const createLimiter = () => ({
  active: 0,
  limit: DEFAULT_KIE_ASSET_UPLOAD_CONCURRENCY,
  queue: [],
});

let processWideLimiter = createLimiter();

const createCancelledError = (message = '任务已取消') => {
  const error = new Error(message);
  error.code = 'request_cancelled';
  error.providerMessage = message;
  return error;
};

const normalizeLimit = (value) => {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_KIE_ASSET_UPLOAD_CONCURRENCY;
};

const configureLimiter = (requestedLimit) => {
  const normalizedLimit = normalizeLimit(requestedLimit);
  if (processWideLimiter.active === 0 && processWideLimiter.queue.length === 0) {
    processWideLimiter.limit = normalizedLimit;
  } else {
    processWideLimiter.limit = Math.min(processWideLimiter.limit, normalizedLimit);
  }
  return processWideLimiter;
};

const removeQueuedWaiter = (limiter, waiter) => {
  const index = limiter.queue.indexOf(waiter);
  if (index >= 0) limiter.queue.splice(index, 1);
};

const drainQueue = (limiter) => {
  while (limiter.active < limiter.limit) {
    const next = limiter.queue.shift();
    if (!next) return;
    next.signal?.removeEventListener?.('abort', next.onAbort);
    if (next.signal?.aborted) {
      next.reject(createCancelledError());
      continue;
    }
    next.grant();
  }
};

const acquireSlot = (requestedLimit, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(createCancelledError());
    return;
  }

  const limiter = configureLimiter(requestedLimit);
  const grant = () => {
    limiter.active += 1;
    let released = false;
    resolve(() => {
      if (released) return;
      released = true;
      limiter.active = Math.max(0, limiter.active - 1);
      drainQueue(limiter);
    });
  };

  if (limiter.active < limiter.limit && limiter.queue.length === 0) {
    grant();
    return;
  }

  const waiter = {
    grant,
    reject,
    signal,
    onAbort: null,
  };
  waiter.onAbort = () => {
    removeQueuedWaiter(limiter, waiter);
    reject(createCancelledError());
    drainQueue(limiter);
  };
  signal?.addEventListener?.('abort', waiter.onAbort, { once: true });
  limiter.queue.push(waiter);
  drainQueue(limiter);
});

export const withKieAssetUploadSlot = async (operation, options = {}) => {
  const release = await acquireSlot(options.limit, options.signal);
  try {
    return await operation();
  } finally {
    release();
  }
};

export const __testOnly_resetKieAssetUploadLimiters = () => {
  const limiter = processWideLimiter;
  for (const waiter of limiter.queue.splice(0)) {
    waiter.signal?.removeEventListener?.('abort', waiter.onAbort);
    waiter.reject(createCancelledError('上传限流器已重置'));
  }
  processWideLimiter = createLimiter();
};
