const DEFAULT_KIE_ASSET_UPLOAD_CONCURRENCY = 3;
const limiterByLimit = new Map();

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

const getLimiter = (limit) => {
  const normalizedLimit = normalizeLimit(limit);
  if (!limiterByLimit.has(normalizedLimit)) {
    limiterByLimit.set(normalizedLimit, {
      active: 0,
      limit: normalizedLimit,
      queue: [],
    });
  }
  return limiterByLimit.get(normalizedLimit);
};

const removeQueuedWaiter = (limiter, waiter) => {
  const index = limiter.queue.indexOf(waiter);
  if (index >= 0) limiter.queue.splice(index, 1);
};

const acquireSlot = (limiter, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(createCancelledError());
    return;
  }

  const grant = () => {
    limiter.active += 1;
    let released = false;
    resolve(() => {
      if (released) return;
      released = true;
      limiter.active = Math.max(0, limiter.active - 1);
      for (;;) {
        const next = limiter.queue.shift();
        if (!next) return;
        next.signal?.removeEventListener?.('abort', next.onAbort);
        if (next.signal?.aborted) {
          next.reject(createCancelledError());
          continue;
        }
        next.grant();
        return;
      }
    });
  };

  if (limiter.active < limiter.limit) {
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
  };
  signal?.addEventListener?.('abort', waiter.onAbort, { once: true });
  limiter.queue.push(waiter);
});

export const withKieAssetUploadSlot = async (operation, options = {}) => {
  const limiter = getLimiter(options.limit);
  const release = await acquireSlot(limiter, options.signal);
  try {
    return await operation();
  } finally {
    release();
  }
};

export const __testOnly_resetKieAssetUploadLimiters = () => {
  for (const limiter of limiterByLimit.values()) {
    for (const waiter of limiter.queue.splice(0)) {
      waiter.signal?.removeEventListener?.('abort', waiter.onAbort);
      waiter.reject(createCancelledError('上传限流器已重置'));
    }
  }
  limiterByLimit.clear();
};
