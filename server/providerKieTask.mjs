const KIE_RECORD_INFO_URL = 'https://api.kie.ai/api/v1/jobs/recordInfo';
const KIE_TRANSIENT_NOT_FOUND_GRACE_MS = 45_000;
const KIE_TRANSIENT_FETCH_ERROR_GRACE_MS = 240_000;
const KIE_HTTP_REQUEST_TIMEOUT_MS = 60_000;

const createProviderError = (code, message, extras = null) => {
  const error = new Error(message);
  error.code = code;
  error.providerMessage = message;
  if (extras && typeof extras === 'object') {
    Object.assign(error, extras);
  }
  return error;
};

export const attachProviderTaskId = (error, providerTaskId) => {
  if (error && typeof error === 'object' && providerTaskId && !error.providerTaskId) {
    error.providerTaskId = providerTaskId;
  }
  return error;
};

const normalizeProviderCreditsConsumed = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

export const extractProviderUsageMeta = (data = {}) => {
  const root = data && typeof data === 'object' ? data : {};
  const nested = root.data && typeof root.data === 'object' ? root.data : {};
  return {
    creditsConsumed: normalizeProviderCreditsConsumed(
      root.creditsConsumed ??
      root.credits_consumed ??
      root.creditsConsumedTotal ??
      nested.creditsConsumed ??
      nested.credits_consumed ??
      nested.creditsConsumedTotal
    ),
    usage: root.usage || nested.usage || root.usageMetadata || nested.usageMetadata || null,
  };
};

const resolveKieTaskSuccessUrl = (result) => {
  const resultJson = JSON.parse(result?.data?.resultJson || '{}');
  return Array.isArray(resultJson.resultUrls) ? resultJson.resultUrls[0] : '';
};

const buildKieTaskSuccessResult = (taskId, result, { isVideo = false, model = '' } = {}) => {
  const url = resolveKieTaskSuccessUrl(result);
  if (!url) {
    throw createProviderError('provider_bad_response', 'Kie 返回成功但没有结果链接', {
      providerTaskId: taskId,
      providerStage: 'polling',
      providerStatus: 'success_without_result',
    });
  }
  const usageMeta = extractProviderUsageMeta(result);
  return {
    providerTaskId: taskId,
    ...(usageMeta.creditsConsumed !== undefined ? { creditsConsumed: usageMeta.creditsConsumed } : {}),
    providerStage: 'completed',
    providerStatus: 'success',
    result: {
      imageUrl: url,
      videoUrl: isVideo ? url : undefined,
      taskId,
      status: 'success',
      providerTaskId: taskId,
      ...(usageMeta.creditsConsumed !== undefined ? { creditsConsumed: usageMeta.creditsConsumed } : {}),
      ...(usageMeta.usage ? { usage: usageMeta.usage } : {}),
      providerModel: result.data?.model || model || '',
    },
  };
};

const mapKieRecordInfoError = ({ responseStatus = 200, result = {}, taskId }) => {
  if (responseStatus === 401 || responseStatus === 403 || result?.code === 401 || result?.code === 403) {
    throw createProviderError('provider_auth_invalid', result?.msg || 'Kie 鉴权失败', {
      providerTaskId: taskId,
      providerStage: 'polling',
      providerStatus: 'auth_invalid',
    });
  }
  if (responseStatus === 404 || result?.code === 404) {
    throw createProviderError('task_not_found', result?.msg || '任务不存在或已过期', {
      providerTaskId: taskId,
      providerStage: 'polling',
      providerStatus: 'not_found',
    });
  }
  if (responseStatus === 429) {
    throw createProviderError('provider_rate_limited', result?.msg || 'Kie 请求过于频繁', {
      providerTaskId: taskId,
      providerStage: 'polling',
      providerStatus: 'rate_limited',
    });
  }
  if (responseStatus >= 500 || result?.code >= 500) {
    throw createProviderError('provider_internal_error', result?.msg || 'Kie 服务异常', {
      providerTaskId: taskId,
      providerStage: 'polling',
      providerStatus: 'server_error',
    });
  }
};

const fetchKieRecordInfo = (taskId, {
  kieApiKey,
  signal,
  fetchWithTimeout,
  isVideo = false,
}) => fetchWithTimeout(`${KIE_RECORD_INFO_URL}?taskId=${encodeURIComponent(taskId)}`, {
  method: 'GET',
  headers: {
    Authorization: `Bearer ${kieApiKey}`,
  },
  signal,
}, isVideo ? 'Kie 视频任务查询超时' : 'Kie 图像任务查询超时', KIE_HTTP_REQUEST_TIMEOUT_MS, 'polling');

export const pollKieTask = async (taskId, {
  kieApiKey,
  signal = null,
  isVideo = false,
  model = '',
  fetchWithTimeout,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  pollRetries = 90,
} = {}) => {
  const maxRetries = isVideo ? 180 : (Number(pollRetries) || 90);
  const startedAt = Date.now();
  let lastKnownState = '';

  for (let i = 0; i < maxRetries; i += 1) {
    if (signal?.aborted) {
      throw createProviderError('request_cancelled', '任务已取消', {
        providerTaskId: taskId,
        providerStage: 'polling',
        providerStatus: lastKnownState || 'cancelled',
      });
    }

    let response;
    try {
      response = await fetchKieRecordInfo(taskId, { kieApiKey, signal, fetchWithTimeout, isVideo });
    } catch (error) {
      if (signal?.aborted) {
        throw createProviderError('request_cancelled', '任务已取消', {
          providerTaskId: taskId,
          providerStage: 'polling',
          providerStatus: lastKnownState || 'cancelled',
        });
      }
      const isTransientFetchError = error instanceof TypeError || /fetch failed/i.test(String(error?.message || ''));
      if (isTransientFetchError && Date.now() - startedAt < KIE_TRANSIENT_FETCH_ERROR_GRACE_MS) {
        await wait(4000, signal);
        continue;
      }
      throw attachProviderTaskId(
        createProviderError('provider_network_error', error?.message || 'Kie 任务查询失败', {
          providerStage: 'polling',
          providerStatus: lastKnownState || 'network_error',
        }),
        taskId
      );
    }

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if ((response.status === 404 || result?.code === 404) && Date.now() - startedAt < KIE_TRANSIENT_NOT_FOUND_GRACE_MS) {
        await wait(4000, signal);
        continue;
      }
      mapKieRecordInfoError({ responseStatus: response.status, result, taskId });
    }

    if (result?.code === 200) {
      const state = result.data?.state;
      lastKnownState = String(state || '').trim() || lastKnownState;
      if (state === 'success') {
        return buildKieTaskSuccessResult(taskId, result, { isVideo, model });
      }
      if (state === 'fail') {
        throw createProviderError('provider_bad_request', result.data?.failMsg || 'Kie 任务失败', {
          providerTaskId: taskId,
          providerStage: 'polling',
          providerStatus: 'failed',
        });
      }
    } else if (result?.code === 404) {
      if (Date.now() - startedAt < KIE_TRANSIENT_NOT_FOUND_GRACE_MS) {
        await wait(4000, signal);
        continue;
      }
      mapKieRecordInfoError({ responseStatus: 404, result, taskId });
    } else {
      mapKieRecordInfoError({ responseStatus: 200, result, taskId });
    }

    await wait(4000, signal);
  }

  throw createProviderError('provider_timeout', isVideo ? '视频合成超时' : '图像任务超时', {
    providerTaskId: taskId,
    providerStage: 'polling',
    providerStatus: lastKnownState || 'timeout',
  });
};

export const probeKieTaskOnce = async (taskId, {
  kieApiKey,
  signal = null,
  isVideo = false,
  fetchWithTimeout,
} = {}) => {
  const response = await fetchKieRecordInfo(taskId, { kieApiKey, signal, fetchWithTimeout, isVideo });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    mapKieRecordInfoError({ responseStatus: response.status, result, taskId });
  }
  if (result?.code === 200) {
    const state = String(result.data?.state || '').trim();
    if (state === 'success') {
      return buildKieTaskSuccessResult(taskId, result, { isVideo });
    }
    if (state === 'fail') {
      throw createProviderError('provider_bad_request', result.data?.failMsg || 'Kie 任务失败', {
        providerTaskId: taskId,
        providerStage: 'polling',
        providerStatus: 'failed',
      });
    }
    return {
      providerTaskId: taskId,
      providerStage: 'polling',
      providerStatus: state || 'pending',
      result: {
        taskId,
        providerTaskId: taskId,
        status: state || 'pending',
      },
    };
  }
  mapKieRecordInfoError({ responseStatus: 200, result, taskId });
  return {
    providerTaskId: taskId,
    providerStage: 'polling',
    providerStatus: 'pending',
    result: {
      taskId,
      providerTaskId: taskId,
      status: 'pending',
    },
  };
};
